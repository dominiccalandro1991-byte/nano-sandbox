/**
 * Macro Engine UI — 5 isolated macros + Sandbox Stress Test + chat telemetry.
 * Live backend: https://nano-sandbox-api.onrender.com
 *
 * Evidence: HTTP paths Verified against Render deploy (a3fe25b surface).
 * Macro roles Partially Verified orchestration wrappers.
 */
(function (global) {
  "use strict";

  var DEFAULT_BACKEND = "https://nano-sandbox-api.onrender.com";

  var MACRO_META = {
    research: {
      icon: "🔬",
      title: "Research",
      blurb: "Deep research · patent-style checks · credentials",
      fields: [
        { key: "query", label: "Research query", type: "text", placeholder: "Prior art / claim check…" },
        { key: "sources", label: "Source hints", type: "text", placeholder: "optional" }
      ]
    },
    inventor: {
      icon: "⚙️",
      title: "Inventor",
      blurb: "Utility engineering · 300–500 lb mass band",
      fields: [
        { key: "concept", label: "Concept", type: "text", placeholder: "Field utility module" },
        { key: "utility_mass_lb", label: "Utility mass (lb)", type: "number", placeholder: "400", value: "400" }
      ]
    },
    coder: {
      icon: "💻",
      title: "Coder",
      blurb: "Multi-file factory · AST / pytest hooks",
      fields: [
        { key: "task", label: "Coding task", type: "text", placeholder: "Generate module…" },
        { key: "language", label: "Language", type: "text", placeholder: "python", value: "python" }
      ]
    },
    deploy: {
      icon: "🚀",
      title: "Deploy",
      blurb: "iOS · Android · GitHub Pages · Vercel",
      fields: [
        { key: "target", label: "Target", type: "text", placeholder: "github-pages", value: "github-pages" },
        { key: "app_name", label: "App name", type: "text", placeholder: "nnacc-v2" }
      ]
    },
    chat: {
      icon: "💬",
      title: "Chat Core",
      blurb: "Vault-bound grounded chat · ciphertext-only server",
      fields: [
        { key: "message", label: "Message", type: "text", placeholder: "Grounded system prompt…" },
        { key: "persona", label: "Persona", type: "text", placeholder: "orchestrator", value: "orchestrator" }
      ]
    }
  };

  function backendBase() {
    try {
      var stored = localStorage.getItem("nnacc-v2-remote") || "";
      if (stored && /^https?:\/\//i.test(stored)) return stored.replace(/\/$/, "");
    } catch (e) {}
    return DEFAULT_BACKEND;
  }

  function setBackendDefault() {
    try {
      if (!localStorage.getItem("nnacc-v2-remote")) {
        localStorage.setItem("nnacc-v2-remote", DEFAULT_BACKEND);
      }
    } catch (e) {}
    var el = document.getElementById("setting-remote");
    if (el && !el.value) el.value = DEFAULT_BACKEND;
  }

  async function postMacro(name, payload) {
    var url = backendBase() + "/nase/macro/" + encodeURIComponent(name);
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ payload: payload || {} })
    });
    var body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = { status: "error", error: "non-JSON response", http_status: res.status };
    }
    body.http_status = res.status;
    return body;
  }

  async function getMacros() {
    var res = await fetch(backendBase() + "/nase/macros", {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error("macros HTTP " + res.status);
    return res.json();
  }

  function renderTelemetryBadge(container, result) {
    if (!container) return;
    var att = result.attestation || {};
    var sig = result.attestation_signature || att.s_attest || "";
    var ok = result.status === "success";
    container.innerHTML =
      '<div class="telemetry-badge ' + (ok ? "ok" : "fail") + '">' +
      '<div class="tel-row"><span class="tel-label">Status</span><span class="tel-val">' +
      escapeHtml(String(result.status || "?")) +
      "</span></div>" +
      '<div class="tel-row"><span class="tel-label">execution_ms</span><span class="tel-val">' +
      escapeHtml(String(result.execution_ms != null ? result.execution_ms : "—")) +
      "</span></div>" +
      '<div class="tel-row"><span class="tel-label">Σ ω·φ</span><span class="tel-val">' +
      escapeHtml(String(att.weighted_sum != null ? att.weighted_sum : "—")) +
      "</span></div>" +
      '<div class="tel-row"><span class="tel-label">engines</span><span class="tel-val">' +
      escapeHtml(String(att.engine_count || 25)) +
      "</span></div>" +
      '<div class="tel-row mono"><span class="tel-label">S_attest</span><span class="tel-val s-attest" title="' +
      escapeHtml(sig) +
      '">' +
      escapeHtml(sig ? sig.slice(0, 16) + "…" + sig.slice(-8) : "—") +
      "</span></div>" +
      (sig
        ? '<button type="button" class="ghost-btn copy-attest" data-sig="' +
          escapeHtml(sig) +
          '">Copy S_attest</button>'
        : "") +
      "</div>";
    container.querySelectorAll(".copy-attest").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var s = btn.getAttribute("data-sig") || "";
        if (s && navigator.clipboard)
          navigator.clipboard.writeText(s).then(function () {
            btn.textContent = "Copied";
            setTimeout(function () {
              btn.textContent = "Copy S_attest";
            }, 1200);
          });
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildMacroGrid(registry) {
    var grid = document.getElementById("macro-engine-grid");
    if (!grid) return;
    var byName = {};
    (registry.macros || []).forEach(function (m) {
      byName[m.macro] = m;
    });
    grid.innerHTML = "";
    Object.keys(MACRO_META).forEach(function (name) {
      var meta = MACRO_META[name];
      var info = byName[name] || { engine_ids: [], engine_registry_ids: [] };
      var card = document.createElement("article");
      card.className = "macro-card";
      card.dataset.macro = name;
      var fieldsHtml = meta.fields
        .map(function (f) {
          return (
            '<label class="macro-field">' +
            escapeHtml(f.label) +
            '<input data-field="' +
            escapeHtml(f.key) +
            '" type="' +
            (f.type || "text") +
            '" placeholder="' +
            escapeHtml(f.placeholder || "") +
            '"' +
            (f.value != null ? ' value="' + escapeHtml(f.value) + '"' : "") +
            " /></label>"
          );
        })
        .join("");
      var regIds = info.engine_registry_ids || [];
      var engIds = info.engine_ids || [];
      var chips = regIds
        .map(function (id) {
          return '<span class="engine-chip" title="' + escapeHtml(id) + '">' + escapeHtml(id) + "</span>";
        })
        .join("");
      var phiRange =
        engIds.length >= 2
          ? "φ" + engIds[0] + "–φ" + engIds[engIds.length - 1]
          : engIds.length === 1
            ? "φ" + engIds[0]
            : "";
      var phiLine =
        '<p class="macro-phi-label">' +
        escapeHtml(phiRange) +
        (regIds.length ? " · " + regIds.length + " engines" : " · awaiting registry") +
        "</p>";
      card.innerHTML =
        '<header class="macro-card-head"><span class="macro-icon">' +
        meta.icon +
        "</span><div><h3>" +
        escapeHtml(meta.title) +
        '</h3><p class="muted small">' +
        escapeHtml(meta.blurb) +
        "</p>" +
        phiLine +
        "</div></header>" +
        '<div class="engine-chip-row" aria-label="Registry engines">' +
        chips +
        "</div>" +
        '<div class="macro-fields">' +
        fieldsHtml +
        "</div>" +
        '<button type="button" class="primary-btn macro-run-btn" data-macro="' +
        name +
        '">Execute ' +
        escapeHtml(meta.title) +
        "</button>" +
        '<div class="macro-telemetry" id="macro-tel-' +
        name +
        '"></div>';
      grid.appendChild(card);
    });
    grid.querySelectorAll(".macro-run-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        runMacroCard(btn.getAttribute("data-macro"));
      });
    });
  }

  function collectPayload(card) {
    var payload = {};
    card.querySelectorAll("[data-field]").forEach(function (input) {
      var k = input.getAttribute("data-field");
      var v = input.value;
      if (input.type === "number" && v !== "") v = Number(v);
      payload[k] = v;
    });
    return payload;
  }

  async function runMacroCard(name) {
    var card = document.querySelector('.macro-card[data-macro="' + name + '"]');
    if (!card) return;
    var btn = card.querySelector(".macro-run-btn");
    var tel = document.getElementById("macro-tel-" + name);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Running…";
    }
    try {
      var result = await postMacro(name, collectPayload(card));
      renderTelemetryBadge(tel, result);
      if (global.NNACCChatTelemetry) global.NNACCChatTelemetry.push(result, name);
    } catch (err) {
      renderTelemetryBadge(tel, {
        status: "error",
        error: String(err && err.message ? err.message : err),
        attestation_signature: ""
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Execute " + (MACRO_META[name] && MACRO_META[name].title ? MACRO_META[name].title : name);
      }
    }
  }

  function wireStressTest() {
    var runBtn = document.getElementById("stress-run-btn");
    var out = document.getElementById("stress-telemetry");
    var input = document.getElementById("stress-json-input");
    var macroSel = document.getElementById("stress-macro-select");
    var presetOk = document.getElementById("stress-preset-ok");
    var presetFail = document.getElementById("stress-preset-fail");
    if (presetOk)
      presetOk.addEventListener("click", function () {
        if (macroSel) macroSel.value = "inventor";
        if (input)
          input.value = JSON.stringify(
            { utility_mass_lb: 400, concept: "in-band utility module" },
            null,
            2
          );
      });
    if (presetFail)
      presetFail.addEventListener("click", function () {
        if (macroSel) macroSel.value = "inventor";
        if (input)
          input.value = JSON.stringify(
            { utility_mass_lb: 100, concept: "out-of-band stress" },
            null,
            2
          );
      });
    if (!runBtn) return;
    runBtn.addEventListener("click", async function () {
      runBtn.disabled = true;
      runBtn.textContent = "Evaluating…";
      try {
        var macro = (macroSel && macroSel.value) || "inventor";
        var payload = {};
        try {
          payload = JSON.parse((input && input.value) || "{}");
        } catch (e) {
          renderTelemetryBadge(out, {
            status: "error",
            error: "Invalid JSON payload",
            attestation_signature: ""
          });
          return;
        }
        var result = await postMacro(macro, payload);
        renderTelemetryBadge(out, result);
        var log = document.getElementById("stress-raw-log");
        if (log) log.textContent = JSON.stringify(result, null, 2);
        if (global.NNACCChatTelemetry) global.NNACCChatTelemetry.push(result, macro);
      } catch (err) {
        renderTelemetryBadge(out, {
          status: "error",
          error: String(err && err.message ? err.message : err),
          attestation_signature: ""
        });
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "Run Stress Evaluation";
      }
    });
  }

  async function refreshRegistry() {
    var statusEl = document.getElementById("macro-backend-status");
    try {
      var data = await getMacros();
      buildMacroGrid(data);
      if (statusEl) {
        statusEl.textContent = "Backend online · " + backendBase();
        statusEl.className = "backend-status online";
      }
    } catch (err) {
      buildMacroGrid({ macros: [] });
      if (statusEl) {
        statusEl.textContent = "Backend unreachable · " + backendBase() + " · " + err.message;
        statusEl.className = "backend-status offline";
      }
    }
  }

  /** Chat telemetry strip + optional macro orchestration for chat sends */
  var NNACCChatTelemetry = {
    last: null,
    push: function (result, macro) {
      this.last = { result: result, macro: macro, at: Date.now() };
      var strip = document.getElementById("chat-telemetry-strip");
      if (!strip) return;
      strip.hidden = false;
      var att = result.attestation || {};
      var sig = result.attestation_signature || att.s_attest || "";
      strip.innerHTML =
        '<span class="cts-pill">' +
        escapeHtml(macro || "macro") +
        "</span>" +
        '<span class="cts-pill">' +
        escapeHtml(String(result.status || "")) +
        "</span>" +
        '<span class="cts-pill">' +
        escapeHtml(String(result.execution_ms != null ? result.execution_ms + " ms" : "")) +
        "</span>" +
        '<span class="cts-pill">Σ ' +
        escapeHtml(String(att.weighted_sum != null ? att.weighted_sum : "—")) +
        "</span>" +
        '<span class="cts-pill mono" title="' +
        escapeHtml(sig) +
        '">S_attest ' +
        escapeHtml(sig ? sig.slice(0, 12) + "…" : "—") +
        "</span>";
    },
    /**
     * Route chat text through macro backend when intent matches.
     * Returns result or null if not routed.
     */
    maybeOrchestrate: async function (text) {
      var lower = (text || "").toLowerCase();
      var macro = null;
      var payload = { message: text };
      if (/\b(inventor|utility|mass\s*lb|\d+\s*lb)\b/.test(lower)) {
        macro = "inventor";
        var m = lower.match(/(\d+(?:\.\d+)?)\s*lb/);
        payload.utility_mass_lb = m ? Number(m[1]) : 400;
        payload.concept = text;
      } else if (/\b(deploy|vercel|github pages|app store)\b/.test(lower)) {
        macro = "deploy";
        payload.target = "github-pages";
        payload.app_name = "nnacc-v2";
      } else if (/\b(code|pytest|generate module|refactor)\b/.test(lower)) {
        macro = "coder";
        payload.task = text;
        payload.language = "python";
      } else if (/\b(research|prior art|patent|credential)\b/.test(lower)) {
        macro = "research";
        payload.query = text;
      } else if (/\b(orchestrat|macro|attest|s_attest|nase)\b/.test(lower)) {
        macro = "chat";
        payload.persona = "orchestrator";
      }
      if (!macro) return null;
      var result = await postMacro(macro, payload);
      this.push(result, macro);
      return result;
    }
  };

  function init() {
    setBackendDefault();
    wireStressTest();
    refreshRegistry();
    var refreshBtn = document.getElementById("macro-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshRegistry);
  }

  global.MacroEngineUI = {
    init: init,
    refresh: refreshRegistry,
    postMacro: postMacro,
    backendBase: backendBase,
    DEFAULT_BACKEND: DEFAULT_BACKEND
  };
  global.NNACCChatTelemetry = NNACCChatTelemetry;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
