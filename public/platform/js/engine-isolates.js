/**
 * Engine Isolates — φ1–φ25 each own local state bag (useState-equivalent isolation).
 * No cross-engine mutation. AEGIS reads snapshots only via explicit export.
 */
(function (global) {
  "use strict";

  var REGISTRY = [
    "soft-body-physics", "multi-agent-interaction", "tcc-anomaly", "cdem-diagnosis", "rte-repair-plan",
    "tier-drift", "physics-qc-matrix", "dependency-collision", "market-absence", "thermal-dissipation",
    "geometry-tolerance", "causal-fusion", "spectral-acoustic", "bayesian-causal", "multi-modal-vision",
    "deploy-ios", "deploy-android", "deploy-pages", "deploy-vercel", "deploy-orchestrator",
    "chat-persona", "chat-grounding", "usse-stress", "oiav-vault", "nnacc-chat"
  ];

  var isolates = {};

  function createIsolate(id, name) {
    var local = {
      id: id,
      name: name,
      status: "idle",
      lastInput: null,
      lastOutput: null,
      error: null,
      updatedAt: 0
    };
    return {
      getState: function () {
        return {
          id: local.id,
          name: local.name,
          status: local.status,
          lastInput: local.lastInput,
          lastOutput: local.lastOutput,
          error: local.error,
          updatedAt: local.updatedAt
        };
      },
      setInput: function (payload) {
        local.lastInput = payload;
        local.status = "armed";
        local.updatedAt = Date.now();
      },
      setOutput: function (out) {
        local.lastOutput = out;
        local.status = "ok";
        local.error = null;
        local.updatedAt = Date.now();
      },
      setError: function (err) {
        local.error = err;
        local.status = "error";
        local.updatedAt = Date.now();
      },
      reset: function () {
        local.status = "idle";
        local.lastInput = null;
        local.lastOutput = null;
        local.error = null;
        local.updatedAt = Date.now();
      }
    };
  }

  for (var i = 0; i < 25; i++) {
    isolates[i + 1] = createIsolate(i + 1, REGISTRY[i]);
  }

  global.EngineIsolates = {
    get: function (id) {
      return isolates[id] || null;
    },
    allSnapshots: function () {
      var out = [];
      for (var k = 1; k <= 25; k++) out.push(isolates[k].getState());
      return out;
    },
    REGISTRY: REGISTRY.slice()
  };
})(typeof window !== "undefined" ? window : globalThis);
