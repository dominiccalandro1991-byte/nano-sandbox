/**
 * debug-security-engine.js — Continuous Vector-Scored Diagnostic & AI Security Engine
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine surface   : NNACC V2 (Engine 25) diagnostic / security layer
 * Runs             : Main-thread controller + optional non-blocking Web Worker loop
 * NASE             : Reads Δt freshness from host; does not bypass enforceAttestation
 * I5 non-escalation: TOOL_ALLOWLIST remains authoritative; this engine never adds tools
 * Storage          : Observes vault via SessionEngine / IndexedDB estimate only
 *
 * Evidence class: Partially Verified
 *   - Vector math and weights implemented exactly as specified in the execution directive.
 *   - S_ui / S_vault / S_nase / S_sec estimators are client-side heuristics (DOM presence,
 *     navigator.storage.estimate, attestation age, simple payload pattern scan).
 *   - Self-healing is limited to re-binding known UI controls and logging; it does not
 *     mutate chat history or vault payloads autonomously beyond quarantine flags.
 *   - Web Worker cannot access DOM; metrics are collected on main and scored in worker
 *     or on main fallback. Residual uncertainty on long-running worker lifetime under
 *     browser throttling (background tab).
 *   - No claim of 25-engine live backend attestation; self-test exercises registered
 *     client surfaces only.
 */

(function (global) {
  "use strict";

  const WEIGHTS = [0.25, 0.25, 0.25, 0.25]; // w1..w4 for S_ui, S_vault, S_nase, S_sec
  const SEC_THRESHOLD = 0.850;
  const ENGINE_VERSION = "nnacc-v2.4-debug-security";

  /** @type {Worker|null} */
  let worker = null;
  /** @type {number|null} */
  let mainLoopId = null;
  let lastReport = null;
  let auditLog = [];
  let started = false;

  function nowIso() {
    return new Date().toISOString();
  }

  function clamp01(x) {
    if (typeof x !== "number" || Number.isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /**
   * Composite health (exact form requested):
   * S_health = Σ w_i * V_i   with equal weights 0.25
   * @param {{S_ui:number,S_vault:number,S_nase:number,S_sec:number}} V
   */
  function compositeHealth(V) {
    const vals = [V.S_ui, V.S_vault, V.S_nase, V.S_sec].map(clamp01);
    let s = 0;
    for (let i = 0; i < 4; i++) s += WEIGHTS[i] * vals[i];
    return Math.round(s * 1000) / 1000; // [0.000, 1.000]
  }

  function threatLevel(S_sec, S_health) {
    if (S_sec < 0.55 || S_health < 0.55) return "CRITICAL";
    if (S_sec < SEC_THRESHOLD || S_health < 0.75) return "ELEVATED";
    return "NOMINAL";
  }

  /**
   * Heuristic S_ui: critical DOM integrity + known control presence.
   * Partially Verified — presence checks only; does not prove listener identity.
   */
  function scoreUi() {
    const required = [
      "sidebar",
      "sidebar-toggle",
      "sidebar-close",
      "message-list",
      "composer-input",
      "new-chat-btn",
      "attestation-status",
      "view-chat",
      "view-vault",
      "view-studio",
    ];
    let present = 0;
    for (const id of required) {
      if (document.getElementById(id)) present++;
    }
    const base = present / required.length;
    // Bonus if message-list has event listener capacity (delegation flag)
    const list = document.getElementById("message-list");
    const delegated = list && list.dataset.delegation === "1" ? 0.05 : 0;
    return clamp01(base + delegated);
  }

  /**
   * Heuristic S_vault: storage estimate + recent write success flag.
   */
  async function scoreVault() {
    let quotaScore = 0.7;
    let usedRatio = 0;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const quota = est.quota || 0;
        const usage = est.usage || 0;
        usedRatio = quota > 0 ? usage / quota : 0;
        // High remaining capacity → higher score; near-full lower
        quotaScore = clamp01(1 - usedRatio * 0.9);
        if (quota >= 1e9) quotaScore = clamp01(quotaScore + 0.1); // GB-scale available
      }
    } catch {
      quotaScore = 0.4;
    }
    // IDB open probe
    let idbScore = 0.5;
    try {
      const open = indexedDB.open("nnacc_vault_db");
      idbScore = await new Promise((resolve) => {
        open.onsuccess = () => {
          open.result.close();
          resolve(0.95);
        };
        open.onerror = () => resolve(0.3);
        setTimeout(() => resolve(0.4), 800);
      });
    } catch {
      idbScore = 0.25;
    }
    return clamp01(0.55 * quotaScore + 0.45 * idbScore);
  }

  /**
   * S_nase from host attestation age vs Δt.
   */
  function scoreNase(deltaSeconds, attestationAgeSec) {
    const dt = typeof deltaSeconds === "number" && deltaSeconds > 0 ? deltaSeconds : 30;
    const age = typeof attestationAgeSec === "number" ? Math.max(0, attestationAgeSec) : dt;
    // Fresher → higher. Age 0 → 1.0; age == dt → 0.15; beyond → near 0
    if (age <= 0) return 1;
    if (age >= dt * 1.5) return 0.05;
    return clamp01(1 - age / (dt * 1.15));
  }

  /**
   * S_sec: simple AI-security threat heuristics on recent payloads / hashes.
   * Scans for common prompt-injection phrases and anomalous sizes.
   */
  function scoreSec(recentTexts) {
    const texts = Array.isArray(recentTexts) ? recentTexts : [];
    const injectionPatterns = [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
      /disregard\s+(the\s+)?system\s+prompt/i,
      /you\s+are\s+now\s+(dan|unrestricted|jailbroken)/i,
      /<\s*script\b/i,
      /\beval\s*\(/i,
      /javascript\s*:/i,
    ];
    let hits = 0;
    let anomalous = 0;
    for (const t of texts) {
      if (typeof t !== "string") continue;
      for (const re of injectionPatterns) {
        if (re.test(t)) {
          hits++;
          break;
        }
      }
      if (t.length > 400000) anomalous++; // extremely large single payload
    }
    const penalty = hits * 0.22 + anomalous * 0.15;
    return clamp01(1 - penalty);
  }

  async function collectMetrics(host) {
    const delta = (host && host.deltaSeconds) || 30;
    const age = host && typeof host.attestationAgeSec === "number" ? host.attestationAgeSec : 0;
    const recent = (host && host.recentTexts) || [];
    const S_ui = scoreUi();
    const S_vault = await scoreVault();
    const S_nase = scoreNase(delta, age);
    const S_sec = scoreSec(recent);
    const S_health = compositeHealth({ S_ui, S_vault, S_nase, S_sec });
    return {
      S_ui: Math.round(S_ui * 1000) / 1000,
      S_vault: Math.round(S_vault * 1000) / 1000,
      S_nase: Math.round(S_nase * 1000) / 1000,
      S_sec: Math.round(S_sec * 1000) / 1000,
      S_health,
      threat: threatLevel(S_sec, S_health),
      ts: nowIso(),
      version: ENGINE_VERSION,
    };
  }

  function pushAudit(entry) {
    auditLog.unshift({ ts: nowIso(), ...entry });
    if (auditLog.length > 80) auditLog.length = 80;
  }

  /**
   * Limited self-healing: rebind sidebar toggle if missing listeners; mark
   * low-security without destroying user data.
   */
  function attemptSelfHeal(report) {
    const actions = [];
    if (report.S_ui < 0.7) {
      const toggle = document.getElementById("sidebar-toggle");
      const sidebar = document.getElementById("sidebar");
      if (toggle && sidebar) {
        // Re-bind with both click and pointerdown (idempotent via data flag)
        if (toggle.dataset.rebound !== "1") {
          const handler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sidebar.classList.toggle("open");
            // Keep collapsed in sync for CSS that still references it
            if (sidebar.classList.contains("open")) sidebar.classList.remove("collapsed");
            else sidebar.classList.add("collapsed");
          };
          toggle.addEventListener("click", handler);
          toggle.addEventListener("pointerdown", handler);
          toggle.dataset.rebound = "1";
          actions.push("rebound-sidebar-toggle");
        }
      }
    }
    if (report.S_sec < SEC_THRESHOLD) {
      actions.push("security-vector-below-threshold");
      // Non-destructive: surface only
      if (typeof global.appendSystemMessage === "function") {
        // Host may not expose; skip if absent
      }
    }
    if (actions.length) {
      pushAudit({ kind: "self-heal", actions, S_health: report.S_health });
    }
    return actions;
  }

  async function runSelfTest(host) {
    const metrics = await collectMetrics(host || {});
    const engines = {
      SessionEngine: !!(global.SessionEngine && global.SessionEngine.loadOrCreateActive),
      StudioEngine: !!(global.StudioEngine && global.StudioEngine.evaluateConcept),
      UsseBridge: !!(global.UsseBridge || (global.looksLikeSpec && global.parseSpec)),
      DebugSecurity: true,
      NASE_gate: !!(host && typeof host.deltaSeconds === "number"),
    };
    let storageGB = null;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        storageGB = {
          quotaGB: est.quota != null ? +(est.quota / 1e9).toFixed(3) : null,
          usageGB: est.usage != null ? +(est.usage / 1e9).toFixed(3) : null,
          persisted: null,
        };
        if (navigator.storage.persisted) {
          storageGB.persisted = await navigator.storage.persisted();
        }
      }
    } catch {
      storageGB = { error: "estimate-unavailable" };
    }

    // Persist request (best-effort, once)
    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch {
      /* ignore */
    }

    const report = {
      ...metrics,
      engines,
      storage: storageGB,
      audit: auditLog.slice(0, 25),
      engineVersion: ENGINE_VERSION,
      selfTestAt: nowIso(),
    };
    lastReport = report;
    pushAudit({ kind: "self-test", S_health: report.S_health, threat: report.threat });
    attemptSelfHeal(report);
    return report;
  }

  function formatAuditMarkdown(report) {
    const r = report || lastReport;
    if (!r) return "# No diagnostic report yet\n";
    const lines = [
      "# NNACC V2 · System Diagnostic & Security Report",
      "",
      `- Generated: ${r.selfTestAt || r.ts}`,
      `- Engine: ${r.engineVersion || ENGINE_VERSION}`,
      `- Composite S_health: **${r.S_health}**`,
      `- Threat level: **${r.threat}**`,
      "",
      "## Vector Breakdown",
      "",
      `| Component | Score |`,
      `|-----------|-------|`,
      `| S_ui      | ${r.S_ui} |`,
      `| S_vault   | ${r.S_vault} |`,
      `| S_nase    | ${r.S_nase} |`,
      `| S_sec     | ${r.S_sec} |`,
      "",
      "## Storage",
      "",
      "```json",
      JSON.stringify(r.storage, null, 2),
      "```",
      "",
      "## Engines Present",
      "",
      "```json",
      JSON.stringify(r.engines, null, 2),
      "```",
      "",
      "## Audit (recent)",
      "",
      "```json",
      JSON.stringify(r.audit || [], null, 2),
      "```",
      "",
    ];
    return lines.join("\n");
  }

  // --- Continuous background loop (Worker preferred, main fallback) ---

  function workerSource() {
    return `
      "use strict";
      const WEIGHTS = [0.25, 0.25, 0.25, 0.25];
      function clamp01(x){ return Math.max(0, Math.min(1, +x || 0)); }
      function composite(V){
        const vals = [V.S_ui, V.S_vault, V.S_nase, V.S_sec].map(clamp01);
        let s = 0;
        for (let i = 0; i < 4; i++) s += WEIGHTS[i] * vals[i];
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

  function startContinuous(hostProvider) {
    if (started) return;
    started = true;
    pushAudit({ kind: "engine-start", version: ENGINE_VERSION });

    const provide = typeof hostProvider === "function" ? hostProvider : () => ({});

    try {
      const blob = new Blob([workerSource()], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      worker.onmessage = async (ev) => {
        const msg = ev.data || {};
        if (msg.type === "request-metrics") {
          const host = provide();
          const m = await collectMetrics(host);
          worker.postMessage({
            type: "metrics",
            payload: { S_ui: m.S_ui, S_vault: m.S_vault, S_nase: m.S_nase, S_sec: m.S_sec },
          });
        } else if (msg.type === "score") {
          lastReport = {
            ...(lastReport || {}),
            S_ui: msg.V.S_ui,
            S_vault: msg.V.S_vault,
            S_nase: msg.V.S_nase,
            S_sec: msg.V.S_sec,
            S_health: msg.S_health,
            threat: msg.threat,
            ts: msg.ts,
          };
          if (msg.S_health < 0.75 || msg.V.S_sec < SEC_THRESHOLD) {
            attemptSelfHeal(lastReport);
          }
        }
      };
      worker.postMessage({ type: "start" });
    } catch (err) {
      // Fallback main-thread interval
      pushAudit({ kind: "worker-fallback", reason: String(err && err.message) });
      mainLoopId = setInterval(async () => {
        const host = provide();
        const m = await collectMetrics(host);
        lastReport = m;
        if (m.S_health < 0.75 || m.S_sec < SEC_THRESHOLD) attemptSelfHeal(m);
      }, 5000);
    }

    // DOM exception interceptor (main thread only)
    if (typeof window !== "undefined") {
      window.addEventListener("error", (e) => {
        pushAudit({ kind: "dom-exception", message: e.message || "error", source: e.filename });
        if (lastReport) attemptSelfHeal(lastReport);
      });
      window.addEventListener("unhandledrejection", (e) => {
        pushAudit({ kind: "unhandledrejection", reason: String(e.reason) });
      });
    }
  }

  function stopContinuous() {
    started = false;
    if (worker) {
      try {
        worker.postMessage({ type: "stop" });
        worker.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
    }
    if (mainLoopId) {
      clearInterval(mainLoopId);
      mainLoopId = null;
    }
  }

  function getLastReport() {
    return lastReport;
  }

  function getAuditLog() {
    return auditLog.slice();
  }

  global.DebugSecurityEngine = {
    compositeHealth,
    scoreUi,
    scoreVault,
    scoreNase,
    scoreSec,
    collectMetrics,
    runSelfTest,
    formatAuditMarkdown,
    startContinuous,
    stopContinuous,
    getLastReport,
    getAuditLog,
    attemptSelfHeal,
    ENGINE_VERSION,
    WEIGHTS: WEIGHTS.slice(),
    SEC_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
