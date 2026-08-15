/**
 * NASE_Daemon — sole globally accessible health state (H_sys).
 * Per SYSTEM_RESTRUCTURE: only H_sys is shared; engines stay isolated.
 */
(function (global) {
  "use strict";

  var DEFAULT_BACKEND = "https://nano-sandbox-api.onrender.com";
  var THRESH_REPAIR = 0.85;
  var THRESH_LOCK = 0.5;
  var INTERVAL_MS = 60000;

  var state = {
    hSys: 1.0,
    phi: new Array(25).fill(0.9),
    threat: "NOMINAL",
    lastProbeAt: 0,
    vaultLocked: false,
    listeners: []
  };

  function backendBase() {
    try {
      var s = localStorage.getItem("nnacc-v2-remote") || localStorage.getItem("vcs-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return DEFAULT_BACKEND;
  }

  function clamp01(x) {
    x = Number(x);
    if (isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function emit() {
    var snap = getSnapshot();
    state.listeners.forEach(function (fn) {
      try {
        fn(snap);
      } catch (e) {}
    });
    try {
      global.dispatchEvent(new CustomEvent("nase:hsys", { detail: snap }));
    } catch (e) {}
    // IF H_sys < 0.85 → force Research Macro diagnostic workspace
    if (snap.hSys < THRESH_REPAIR) {
      try {
        global.dispatchEvent(
          new CustomEvent("nase:force-research", {
            detail: { hSys: snap.hSys, reason: "H_sys below repair threshold" }
          })
        );
      } catch (e) {}
    }
  }

  function computeHsys(phi, faultNorm) {
    var Q = 0.9;
    var lambda = 0.35;
    var omega = 1 / 25;
    var sum = 0;
    for (var k = 0; k < 25; k++) {
      sum += omega * (1 - clamp01(Math.abs(clamp01(phi[k]) - Q)));
    }
    var raw = sum - lambda * clamp01(faultNorm);
    var h = 1 / (1 + Math.exp(-(raw - 0.55) * 8));
    return Math.round(clamp01(h) * 1000) / 1000;
  }

  async function probe() {
    var faults = 0;
    var phi = state.phi.slice();
    var base = backendBase();
    try {
      var hr = await fetch(base + "/health");
      if (!hr.ok) faults += 0.3;
    } catch (e) {
      faults += 0.45;
    }
    try {
      var mr = await fetch(base + "/nase/macros");
      if (mr.ok) {
        var mj = await mr.json();
        var macros = mj.macros || [];
        macros.forEach(function (m) {
          (m.engine_ids || []).forEach(function (id) {
            var i = (id - 1) | 0;
            if (i >= 0 && i < 25) phi[i] = 0.92;
          });
        });
      } else faults += 0.2;
    } catch (e) {
      faults += 0.25;
    }
    state.phi = phi.map(clamp01);
    state.hSys = computeHsys(state.phi, faults);
    state.threat =
      state.hSys < THRESH_LOCK ? "CRITICAL" : state.hSys < THRESH_REPAIR ? "ELEVATED" : "NOMINAL";
    state.vaultLocked = state.hSys < THRESH_LOCK;
    state.lastProbeAt = Date.now();
    try {
      document.body.classList.toggle("vault-locked", state.vaultLocked);
    } catch (e) {}
    emit();
    return getSnapshot();
  }

  function getSnapshot() {
    return {
      hSys: state.hSys,
      phi: state.phi.slice(),
      threat: state.threat,
      vaultLocked: state.vaultLocked,
      lastProbeAt: state.lastProbeAt
    };
  }

  function subscribe(fn) {
    state.listeners.push(fn);
    return function () {
      state.listeners = state.listeners.filter(function (f) {
        return f !== fn;
      });
    };
  }

  /** Sole global accessor — do not mirror engine-local state here */
  var NASE_Daemon = {
    init: function () {
      probe();
      setInterval(function () {
        if (typeof document !== "undefined" && document.hidden) return;
        probe();
      }, INTERVAL_MS);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) probe();
        });
      }
    },
    probe: probe,
    getHsys: function () {
      return state.hSys;
    },
    getSnapshot: getSnapshot,
    subscribe: subscribe,
    THRESH_REPAIR: THRESH_REPAIR,
    THRESH_LOCK: THRESH_LOCK,
    backendBase: backendBase
  };

  global.NASE_Daemon = NASE_Daemon;
})(typeof window !== "undefined" ? window : globalThis);
