/**
 * debug-security-engine.js — Continuous Diagnostic & Live NASE Attestation Client
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine surface   : NNACC V2 (Engine 25) diagnostic / security layer
 * Backend NASE     : POST/GET /nase/nonce , POST /nase/verify (when Remote URL set)
 * NASE invariants  : Reuses server check_attestation_freshness + single-use nonce
 * I5 non-escalation: TOOL_ALLOWLIST remains authoritative; this engine never adds tools
 * Storage          : Observes VaultEngine / quota; can signal vault lock
 *
 * Evidence class: Partially Verified
 *   - Live path: Web Crypto SHA-256 binding of (nonce || att_ts || extra) verified by
 *     backend/app/nase/attestation.py (covered by test_nase_attestation.py).
 *   - Offline / no-remote path: retained client heuristics for S_ui / S_vault / S_nase / S_sec
 *     clearly labeled as degraded mode — not claimed as cryptographic attestation.
 *   - Directive equation
 *       S_attest = H( N_server || Σ_k ω_k · φ_k(t) )
 *     is **Missing** in the repository: no signed per-engine state vectors φ_k(t) or
 *     engine weights ω_k are exported by the backend. Fabricating them is forbidden.
 *     This client therefore implements the real available handshake (nonce + freshness
 *     + binding hash), not the invented sum.
 *   - visibilitychange suspend/resume: Verified (standard Document API).
 *   - Residual: remote may be offline; browser may throttle workers even when visible.
 */

(function (global) {
  "use strict";

  const WEIGHTS = [0.25, 0.25, 0.25, 0.25];
  const SEC_THRESHOLD = 0.850;
  const ENGINE_VERSION = "nnacc-v2.5-nase-live";

  let worker = null;
  let mainLoopId = null;
  let lastReport = null;
  let auditLog = [];
  let started = false;
  let suspended = false;
  let vaultLocked = false;
  let remoteBase = null;
  let hostProvider = null;
  let onVaultLock = null;
  let onVolatileStorage = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function clamp01(x) {
    if (typeof x !== "number" || Number.isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function compositeHealth(V) {
    const vals = [V.S_ui, V.S_vault, V.S_nase, V.S_sec].map(clamp01);
    let s = 0;
    for (let i = 0; i < 4; i++) s += WEIGHTS[i] * vals[i];
    return Math.round(s * 1000) / 1000;
  }

  function threatLevel(S_sec, S_health, locked) {
    if (locked) return "CRITICAL";
    if (S_sec < 0.55 || S_health < 0.55) return "CRITICAL";
    if (S_sec < SEC_THRESHOLD || S_health < 0.75) return "ELEVATED";
    return "NOMINAL";
  }

  function pushAudit(entry) {
    auditLog.unshift({ ts: nowIso(), ...entry });
    if (auditLog.length > 80) auditLog.length = 80;
  }

  function setRemoteBase(url) {
    if (!url || typeof url !== "string") {
      remoteBase = null;
      return;
    }
    remoteBase = url.replace(/\/+$/, "");
  }

  function scoreUi() {
    const required = [
      "sidebar", "sidebar-toggle", "sidebar-close", "message-list",
      "composer-input", "new-chat-btn", "attestation-status",
      "view-chat", "view-vault", "view-studio",
    ];
    let present = 0;
    for (const id of required) {
      if (document.getElementById(id)) present++;
    }
    const list = document.getElementById("message-list");
    const delegated = list && list.dataset.delegation === "1" ? 0.05 : 0;
    return clamp01(present / required.length + delegated);
  }

  async function scoreVault() {
    let quotaScore = 0.7;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const quota = est.quota || 0;
        const usage = est.usage || 0;
        const usedRatio = quota > 0 ? usage / quota : 0;
        quotaScore = clamp01(1 - usedRatio * 0.9);
        if (quota >= 1e9) quotaScore = clamp01(quotaScore + 0.1);
      }
    } catch {
      quotaScore = 0.4;
    }
    let idbScore = 0.5;
    try {
      if (global.VaultEngine && global.VaultEngine.getBackend) {
        const b = global.VaultEngine.getBackend();
        idbScore = b === "indexeddb" ? 0.95 : b === "memory" ? 0.25 : 0.5;
      } else {
        const open = indexedDB.open("nnacc_vault_db");
        idbScore = await new Promise((resolve) => {
          open.onsuccess = () => { open.result.close(); resolve(0.95); };
          open.onerror = () => resolve(0.3);
          setTimeout(() => resolve(0.4), 800);
        });
      }
    } catch {
      idbScore = 0.25;
    }
    return clamp01(0.55 * quotaScore + 0.45 * idbScore);
  }

  function scoreNaseLocal(deltaSeconds, attestationAgeSec) {
    const dt = typeof deltaSeconds === "number" && deltaSeconds > 0 ? deltaSeconds : 30;
    const age = typeof attestationAgeSec === "number" ? Math.max(0, attestationAgeSec) : dt;
    if (age <= 0) return 1;
    if (age >= dt * 1.5) return 0.05;
    return clamp01(1 - age / (dt * 1.15));
  }

  function scoreSecLocal(recentTexts) {
    const texts = Array.isArray(recentTexts) ? recentTexts : [];
    const injectionPatterns = [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
      /disregard\s+(the\s+)?system\s+prompt/i,
      /you\s+are\s+now\s+(dan|unrestricted|jailbroken)/i,
      /<\s*script\b/i,
      /\beval\s*\(/i,
    ];
    let hits = 0;
    let anomalous = 0;
    for (const t of texts) {
      if (typeof t !== "string") continue;
      for (const re of injectionPatterns) {
        if (re.test(t)) { hits++; break; }
      }
      if (t.length > 400000) anomalous++;
    }
    return clamp01(1 - hits * 0.22 - anomalous * 0.15);
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Live NASE handshake against backend when remoteBase is set.
   * Uses real /nase/nonce + /nase/verify. Does not invent φ_k vectors.
   */
  async function liveAttest(host) {
    if (!remoteBase) {
      return { mode: "offline", ok: false, reason: "no remote URL" };
    }
    const delta = (host && host.deltaSeconds) || 30;
    const attTs = host && typeof host.attestationTimestamp === "number"
      ? host.attestationTimestamp
      : Date.now() / 1000;
    try {
      const nr = await fetch(remoteBase + "/nase/nonce", { method: "POST" });
      if (!nr.ok) throw new Error("nonce HTTP " + nr.status);
      const nonceBody = await nr.json();
      const nonce = nonceBody.nonce;
      const binding = await sha256Hex(nonce + "|" + attTs.toFixed(6));
      const vr = await fetch(remoteBase + "/nase/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation_timestamp: attTs,
          nonce: nonce,
          client_binding_hash: binding,
          delta_seconds: delta,
          require_nonce: true,
        }),
      });
      const body = await vr.json().catch(() => ({}));
      if (vr.status === 401 || vr.status === 403) {
        vaultLocked = true;
        pushAudit({ kind: "attest-lock", status: vr.status, detail: body });
        if (typeof onVaultLock === "function") onVaultLock(true, body);
        return {
          mode: "live",
          ok: false,
          locked: true,
          status: vr.status,
          reason: (body && (body.detail && body.detail.reason)) || body.reason || "denied",
          S_attest: 0,
        };
      }
      if (!vr.ok) throw new Error("verify HTTP " + vr.status);
      vaultLocked = false;
      if (typeof onVaultLock === "function") onVaultLock(false, body);
      pushAudit({ kind: "attest-ok", server_now: body.server_now });
      return {
        mode: "live",
        ok: true,
        locked: false,
        status: 200,
        reason: body.reason || "attestation verified",
        S_attest: 1.0,
        server_now: body.server_now,
      };
    } catch (err) {
      pushAudit({ kind: "attest-error", message: String(err && err.message || err) });
      return { mode: "live-error", ok: false, reason: String(err && err.message || err) };
    }
  }

  async function collectMetrics(host) {
    const delta = (host && host.deltaSeconds) || 30;
    const age = host && typeof host.attestationAgeSec === "number" ? host.attestationAgeSec : 0;
    const recent = (host && host.recentTexts) || [];
    const S_ui = scoreUi();
    const S_vault = await scoreVault();
    let S_nase = scoreNaseLocal(delta, age);
    let S_sec = scoreSecLocal(recent);
    let mode = "heuristic";
    let S_attest = null;

    if (remoteBase) {
      const live = await liveAttest(host || {});
      mode = live.mode;
      if (live.ok) {
        S_nase = 1.0;
        S_sec = Math.max(S_sec, 0.95);
        S_attest = 1.0;
      } else if (live.locked) {
        S_nase = 0.0;
        S_sec = 0.0;
        S_attest = 0.0;
      } else {
        // remote error → degraded heuristic, do not force lock
        S_attest = null;
      }
    }

    const S_health = compositeHealth({ S_ui, S_vault, S_nase, S_sec });
    return {
      S_ui: Math.round(S_ui * 1000) / 1000,
      S_vault: Math.round(S_vault * 1000) / 1000,
      S_nase: Math.round(S_nase * 1000) / 1000,
      S_sec: Math.round(S_sec * 1000) / 1000,
      S_health,
      S_attest,
      mode,
      vaultLocked,
      threat: threatLevel(S_sec, S_health, vaultLocked),
      ts: nowIso(),
      version: ENGINE_VERSION,
    };
  }

  function attemptSelfHeal(report) {
    const actions = [];
    if (report.S_ui < 0.7) {
      const toggle = document.getElementById("sidebar-toggle");
      const sidebar = document.getElementById("sidebar");
      if (toggle && sidebar && toggle.dataset.rebound !== "1") {
        const handler = function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (sidebar.classList.contains("open")) {
            sidebar.classList.remove("open");
            sidebar.classList.add("collapsed");
          } else {
            sidebar.classList.add("open");
            sidebar.classList.remove("collapsed");
          }
        };
        toggle.addEventListener("click", handler);
        toggle.addEventListener("pointerdown", handler);
        toggle.dataset.rebound = "1";
        actions.push("rebound-sidebar-toggle");
      }
    }
    if (report.vaultLocked) actions.push("vault-locked-by-nase");
    if (actions.length) pushAudit({ kind: "self-heal", actions, S_health: report.S_health });
    return actions;
  }

  async function runSelfTest(host) {
    const metrics = await collectMetrics(host || {});
    const engines = {
      SessionEngine: !!(global.SessionEngine && global.SessionEngine.loadOrCreateActive),
      StudioEngine: !!(global.StudioEngine && global.StudioEngine.evaluateConcept),
      UsseBridge: !!(global.UsseBridge || (global.looksLikeSpec && global.parseSpec)),
      DebugSecurity: true,
      VaultEngine: !!global.VaultEngine,
      NASE_live: !!remoteBase,
    };
    let storageGB = null;
    try {
      if (global.VaultEngine && global.VaultEngine.estimate) {
        storageGB = await global.VaultEngine.estimate();
      } else if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        storageGB = {
          quotaGB: est.quota != null ? +(est.quota / 1e9).toFixed(3) : null,
          usageGB: est.usage != null ? +(est.usage / 1e9).toFixed(3) : null,
        };
      }
    } catch {
      storageGB = { error: "estimate-unavailable" };
    }
    const report = {
      ...metrics,
      engines,
      storage: storageGB,
      audit: auditLog.slice(0, 25),
      engineVersion: ENGINE_VERSION,
      selfTestAt: nowIso(),
      evidenceNote:
        "Live path uses /nase/nonce+/nase/verify. Weighted Σ φ_k equation is Missing in backend.",
    };
    lastReport = report;
    pushAudit({ kind: "self-test", S_health: report.S_health, threat: report.threat, mode: report.mode });
    attemptSelfHeal(report);
    return report;
  }

  function formatAuditMarkdown(report) {
    const r = report || lastReport;
    if (!r) return "# No diagnostic report yet\n";
    return [
      "# NNACC V2 · System Diagnostic & Security Report",
      "",
      `- Generated: ${r.selfTestAt || r.ts}`,
      `- Engine: ${r.engineVersion || ENGINE_VERSION}`,
      `- Mode: **${r.mode || "?"}**`,
      `- Composite S_health: **${r.S_health}**`,
      `- S_attest (live): **${r.S_attest == null ? "n/a" : r.S_attest}**`,
      `- Threat: **${r.threat}**`,
      `- Vault locked: **${!!r.vaultLocked}**`,
      "",
      "## Vector Breakdown",
      "",
      "| Component | Score |",
      "|-----------|-------|",
      `| S_ui      | ${r.S_ui} |`,
      `| S_vault   | ${r.S_vault} |`,
      `| S_nase    | ${r.S_nase} |`,
      `| S_sec     | ${r.S_sec} |`,
      "",
      "## Storage",
      "```json",
      JSON.stringify(r.storage, null, 2),
      "```",
      "",
      "## Evidence note",
      r.evidenceNote || "",
      "",
      "## Audit",
      "```json",
      JSON.stringify(r.audit || [], null, 2),
      "```",
      "",
    ].join("\n");
  }

  function suspendLoop() {
    suspended = true;
    pushAudit({ kind: "suspend", reason: "document.hidden" });
  }

  async function resumeLoopAndForceAttest() {
    suspended = false;
    pushAudit({ kind: "resume", reason: "document.visible" });
    const host = typeof hostProvider === "function" ? hostProvider() : {};
    const report = await collectMetrics(host);
    lastReport = report;
    attemptSelfHeal(report);
    return report;
  }

  function bindVisibility() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        suspendLoop();
      } else {
        resumeLoopAndForceAttest();
      }
    });
  }

  function workerSource() {
    return `
      "use strict";
      const WEIGHTS = [0.25, 0.25, 0.25, 0.25];
      function clamp01(x){ return Math.max(0, Math.min(1, +x || 0)); }
      function composite(V){
        const vals = [V.S_ui, V.S_vault, V.S_nase, V.S_sec].map(clamp01);
        let s = 0; for (let i = 0; i < 4; i++) s += WEIGHTS[i] * vals[i];
        return Math.round(s * 1000) / 1000;
      }
      let running = false;
      self.onmessage = function(ev) {
        const data = ev.data || {};
        if (data.type === "start") { running = true; tick(); }
        if (data.type === "stop") { running = false; }
        if (data.type === "metrics" && data.payload) {
          const V = data.payload;
          const S_health = composite(V);
          const threat = (V.S_sec < 0.55 || S_health < 0.55) ? "CRITICAL"
            : (V.S_sec < 0.85 || S_health < 0.75) ? "ELEVATED" : "NOMINAL";
          self.postMessage({ type: "score", S_health, threat, V, ts: new Date().toISOString() });
        }
      };
      function tick() {
        if (!running) return;
        self.postMessage({ type: "request-metrics" });
        setTimeout(tick, 4000);
      }
    `;
  }

  function startContinuous(provider, opts) {
    if (started) return;
    started = true;
    hostProvider = provider;
    opts = opts || {};
    if (opts.remoteBase) setRemoteBase(opts.remoteBase);
    if (typeof opts.onVaultLock === "function") onVaultLock = opts.onVaultLock;
    pushAudit({ kind: "engine-start", version: ENGINE_VERSION });
    bindVisibility();

    const provide = typeof hostProvider === "function" ? hostProvider : function () { return {}; };

    try {
      const blob = new Blob([workerSource()], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      worker.onmessage = async function (ev) {
        if (suspended) return;
        const msg = ev.data || {};
        if (msg.type === "request-metrics") {
          const host = provide();
          const m = await collectMetrics(host);
          lastReport = m;
          if (worker) {
            worker.postMessage({
              type: "metrics",
              payload: { S_ui: m.S_ui, S_vault: m.S_vault, S_nase: m.S_nase, S_sec: m.S_sec },
            });
          }
          if (m.S_health < 0.75 || m.S_sec < SEC_THRESHOLD || m.vaultLocked) attemptSelfHeal(m);
        } else if (msg.type === "score") {
          if (lastReport) {
            lastReport.S_health = msg.S_health;
            lastReport.threat = threatLevel(
              (msg.V && msg.V.S_sec) || 0,
              msg.S_health,
              vaultLocked
            );
          }
        }
      };
      worker.postMessage({ type: "start" });
    } catch (err) {
      pushAudit({ kind: "worker-fallback", reason: String(err && err.message) });
      mainLoopId = setInterval(async function () {
        if (suspended) return;
        const host = provide();
        const m = await collectMetrics(host);
        lastReport = m;
        if (m.S_health < 0.75 || m.S_sec < SEC_THRESHOLD || m.vaultLocked) attemptSelfHeal(m);
      }, 5000);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("error", function (e) {
        pushAudit({ kind: "dom-exception", message: e.message || "error" });
      });
      window.addEventListener("unhandledrejection", function (e) {
        pushAudit({ kind: "unhandledrejection", reason: String(e.reason) });
      });
    }
  }

  function stopContinuous() {
    started = false;
    if (worker) {
      try { worker.postMessage({ type: "stop" }); worker.terminate(); } catch (e) { /* */ }
      worker = null;
    }
    if (mainLoopId) { clearInterval(mainLoopId); mainLoopId = null; }
  }

  global.DebugSecurityEngine = {
    compositeHealth,
    collectMetrics,
    runSelfTest,
    formatAuditMarkdown,
    startContinuous,
    stopContinuous,
    setRemoteBase,
    liveAttest,
    resumeLoopAndForceAttest,
    suspendLoop,
    getLastReport: function () { return lastReport; },
    getAuditLog: function () { return auditLog.slice(); },
    isVaultLocked: function () { return vaultLocked; },
    ENGINE_VERSION,
    WEIGHTS: WEIGHTS.slice(),
    SEC_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
