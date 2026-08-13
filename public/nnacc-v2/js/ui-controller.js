/**
 * ui-controller.js — NNACC V2 + Creative Studio shell controller
 *
 * CONNECTIVITY MAP (do not remove)
 * --------------------------------
 * Engine 25 (NNACC)  : primary chat surface, message list, composer
 * Engine 23 (USSE)   : delegates detection + payload build to usse-bridge.js
 * Engine 24 (OIAV)   : sealCurrentTranscript()
 * StudioEngine       : evaluateConcept / generateCanvasMap / generateStudioPrompt
 * NASE Δt ≤ 30 s     : enforceAttestation() before every mutation
 * I5 non-escalation  : TOOL_ALLOWLIST hard gate
 *
 * Pure static asset for GitHub Pages. NASE + I5 gates preserved.
 */

(function () {
  "use strict";

  const DEFAULT_DELTA_SECONDS = 30;
  let deltaSeconds = DEFAULT_DELTA_SECONDS;
  let attestationTimestamp = Date.now() / 1000;

  const TOOL_ALLOWLIST = new Set([
    "nnacc-chat",
    "usse-stress",
    "oiav-vault",
    "nase-aegis",
    "nadre-monitor",
    "soft-body-physics",
    "thermal-dissipation",
    "geometry-tolerance",
    "rte-repair-plan",
    "causal-fusion",
    "studio-validate",
  ]);

  const state = {
    messages: [],
    currentView: "chat",
    remoteUrl: localStorage.getItem("nnacc-v2-remote") || "",
    autoUsse: localStorage.getItem("nnacc-v2-auto-usse") !== "false",
    pendingUssePayload: null,
    lastStudioPrompt: null,
    lastStudioValidation: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const messageList = $("#message-list");
  const composer = $("#composer-input");
  const dropZone = $("#drop-zone");
  const sidebar = $("#sidebar");
  const settingsModal = $("#settings-modal");
  const attestationStatus = $("#attestation-status");
  const attestationText = $("#attestation-text");

  function refreshAttestation() {
    attestationTimestamp = Date.now() / 1000;
    updateAttestationUI();
  }

  function checkAttestationFreshness() {
    const now = Date.now() / 1000;
    const age = now - attestationTimestamp;
    if (age > deltaSeconds) {
      return { ok: false, reason: "attestation stale: age=" + age.toFixed(1) + "s exceeds Δt=" + deltaSeconds + "s" };
    }
    return { ok: true, reason: "attestation fresh: age=" + age.toFixed(1) + "s ≤ Δt=" + deltaSeconds + "s" };
  }

  function enforceAttestation(actionLabel) {
    const result = checkAttestationFreshness();
    updateAttestationUI();
    if (!result.ok) {
      appendSystemMessage("NASE blocked \u201c" + actionLabel + "\u201d: " + result.reason + ". Refresh the page or open Settings to renew.");
      return false;
    }
    return true;
  }

  function updateAttestationUI() {
    const result = checkAttestationFreshness();
    if (attestationStatus) attestationStatus.classList.toggle("stale", !result.ok);
    if (attestationText) attestationText.textContent = result.ok ? "Δt fresh (" + deltaSeconds + "s)" : "Δt STALE";
  }

  ["click", "keydown", "pointerdown"].forEach(function (evt) {
    document.addEventListener(evt, function () {
      var age = Date.now() / 1000 - attestationTimestamp;
      if (age > deltaSeconds * 0.5) refreshAttestation();
    }, { passive: true });
  });

  function appendMessage(opts) {
    var id = "m-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    var msg = {
      id: id,
      role: opts.role,
      text: opts.text,
      tool: opts.tool,
      hash: opts.hash,
      ts: Date.now(),
      actions: opts.actions,
    };
    state.messages.push(msg);
    renderMessage(msg);
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
    persistSession();
    return msg;
  }

  function appendSystemMessage(text) {
    return appendMessage({ role: "system", text: text });
  }

  function renderMessage(msg) {
    if (!messageList) return;
    var el = document.createElement("div");
    el.className = "msg " + msg.role;
    el.dataset.id = msg.id;

    var meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = "<span>" + msg.role + "</span>";
    if (msg.tool) meta.innerHTML += "<span>\u00b7 " + msg.tool + "</span>";
    if (msg.hash) meta.innerHTML += "<span class=\"hash\">" + msg.hash + "</span>";

    var copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(msg.text).then(function () {
        copyBtn.textContent = "Copied";
        setTimeout(function () { copyBtn.textContent = "Copy"; }, 1200);
      });
    });
    meta.appendChild(copyBtn);

    var body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = msg.text;

    el.appendChild(meta);
    el.appendChild(body);

    if (msg.actions && msg.actions.length) {
      msg.actions.forEach(function (action) {
        var chip = document.createElement("button");
        chip.className = "action-chip";
        chip.textContent = action.label;
        chip.addEventListener("click", function () { action.handler(); });
        el.appendChild(chip);
      });
    }

    messageList.appendChild(el);
  }

  function shortHash(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (digest) {
      return Array.from(new Uint8Array(digest)).map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("").slice(0, 12);
    }).catch(function () {
      return String(text.length);
    });
  }

  function persistSession() {
    try {
      localStorage.setItem("nnacc-v2-session", JSON.stringify({
        updatedAt: Date.now(),
        messages: state.messages.filter(function (m) { return m.role !== "system"; }),
      }));
    } catch (e) { /* quota */ }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem("nnacc-v2-session");
      if (!raw) return;
      var data = JSON.parse(raw);
      (data.messages || []).forEach(function (m) {
        state.messages.push(m);
        renderMessage(m);
      });
    } catch (e) { /* ignore */ }
  }

  function sendMessage(text) {
    if (!text || !text.trim()) return;
    if (!enforceAttestation("chat send")) return;

    var trimmed = text.trim();
    shortHash("user:" + trimmed + ":" + Date.now()).then(function (userHash) {
      appendMessage({ role: "user", text: trimmed, hash: userHash });

      var tool = null;
      var lower = trimmed.toLowerCase();
      if (/\b(usse|stress|torque|load\s*lb|400\s*lb|500\s*lb)\b/i.test(lower)) tool = "usse-stress";
      else if (/\b(oiav|vault|seal|copyright|patent)\b/i.test(lower)) tool = "oiav-vault";
      else if (/\b(nase|attestation|gateway)\b/i.test(lower)) tool = "nase-aegis";
      else if (/\b(nadre|self-?heal|memory\s*pressure)\b/i.test(lower)) tool = "nadre-monitor";
      else if (/\b(studio|canvas|prompt|8k|key\s*visual)\b/i.test(lower)) tool = "studio-validate";

      if (tool && !TOOL_ALLOWLIST.has(tool)) {
        appendSystemMessage("I5 non-escalation: tool \u201c" + tool + "\u201d is not on the allow-list. Refused.");
        return;
      }

      var reply;
      var actions = [];

      if (tool === "usse-stress") {
        reply = "Routing proposal \u2192 **usse-stress** (Engine 23). NASE attestation is fresh. Use the action chip or open the USSE Lab.";
        actions.push({
          label: "\u26a1 Incentivize / Run USSE Stress Test",
          handler: function () {
            if (!enforceAttestation("USSE dispatch")) return;
            var payload = window.USSEBridge
              ? window.USSEBridge.buildFromText(trimmed)
              : { force_n: 0, load_lb: 400, note: "fallback" };
            state.pendingUssePayload = payload;
            var preview = $("#usse-preview");
            if (preview) preview.textContent = JSON.stringify(payload, null, 2);
            var runBtn = $("#run-usse-btn");
            if (runBtn) runBtn.disabled = false;
            switchView("usse");
          },
        });
      } else if (tool === "oiav-vault") {
        reply = "Routing proposal \u2192 **oiav-vault** (Engine 24). Ready to Merkle-seal the current transcript when you confirm.";
        actions.push({
          label: "\ud83d\udd12 Seal transcript in OIAV",
          handler: function () { sealCurrentTranscript(); },
        });
      } else if (tool === "studio-validate") {
        reply = "Routing \u2192 **Creative Studio**. Paste or drop a concept in the Creative Canvas view and press \u201cValidate via 25 Engines & Map Canvas\u201d.";
        actions.push({
          label: "\ud83c\udfa8 Open Creative Studio",
          handler: function () { switchView("studio"); },
        });
      } else if (tool) {
        reply = "Routing proposal \u2192 **" + tool + "**. NASE attestation fresh. On a live backend this would submit a structured job via the Remote path.";
      } else if (/(hello|hi|hey|help)/i.test(lower)) {
        reply = "NNACC V2 + Creative Studio online. I ground turns in the habitat, gate tools with NASE (\u0394t \u2264 " + deltaSeconds + "s), and refuse privilege escalation. Drop a .md/.txt physics or game spec to auto-route into USSE, open Creative Canvas for 8K studio prompts, or say an engine name.";
      } else {
        reply = "Acknowledged. No diagnostic tool intent matched. Message recorded under the session trail. Try \u201crun USSE on 400 lb load\u201d, \u201cseal IP in OIAV\u201d, \u201copen studio\u201d, or drop a specification file.";
      }

      shortHash("assistant:" + reply + ":" + Date.now()).then(function (aHash) {
        appendMessage({ role: "assistant", text: reply, tool: tool, hash: aHash, actions: actions });
      });
    });
  }

  function ingestFile(file) {
    if (!enforceAttestation("file ingest")) return;
    var name = file.name || "untitled";
    file.text().then(function (text) {
      shortHash(name + text.slice(0, 200)).then(function (h) {
        appendMessage({
          role: "user",
          text: "[File ingested: " + name + "]\n\n" + text.slice(0, 4000) + (text.length > 4000 ? "\n\u2026(truncated for display)" : ""),
          hash: h,
        });

        if (state.autoUsse && window.USSEBridge && window.USSEBridge.looksLikeSpec(text, name)) {
          var payload = window.USSEBridge.parseSpec(text, name);
          state.pendingUssePayload = payload;
          var preview = $("#usse-preview");
          if (preview) preview.textContent = JSON.stringify(payload, null, 2);
          var runBtn = $("#run-usse-btn");
          if (runBtn) runBtn.disabled = false;

          appendMessage({
            role: "assistant",
            text: "Detected a specification-like document (\u201c" + name + "\u201d). Engine 23 (USSE) payload has been prepared. NASE attestation is fresh.",
            tool: "usse-stress",
            actions: [{
              label: "\u26a1 Incentivize / Run USSE Stress Test",
              handler: function () {
                if (!enforceAttestation("USSE dispatch")) return;
                switchView("usse");
              },
            }],
          });
        } else {
          appendMessage({
            role: "assistant",
            text: "File \u201c" + name + "\u201d stored in session context. No USSE signals detected (or auto-detect is off). You can also open Creative Canvas to run the 25-engine validation + 8K prompt pipeline.",
          });
        }
      });
    });
  }

  function runStudioPipeline(text, filename) {
    if (!enforceAttestation("studio validate")) return;
    if (!window.StudioEngine) {
      appendSystemMessage("StudioEngine not loaded.");
      return;
    }

    var validation = window.StudioEngine.evaluateConcept(text, filename || "studio-input");
    state.lastStudioValidation = validation;

    var valEl = $("#studio-validation");
    var valHtml = "Status: " + (validation.ok ? "PASS" : "BLOCKED") + "\n";
    valHtml += "Summary: " + validation.summary + "\n";
    valHtml += "Engines touched: " + (validation.enginesHit.join(", ") || "(none)") + "\n";
    valHtml += "Source: " + validation.source + " \u00b7 length " + validation.length + "\n\n";
    if (validation.flags && validation.flags.length) {
      valHtml += "Flags:\n";
      validation.flags.forEach(function (f) {
        valHtml += "  [" + f.severity.toUpperCase() + "] " + f.engine + " \u00b7 " + f.code + "\n    " + f.message + "\n";
      });
    } else {
      valHtml += "Flags: none\n";
    }
    if (valEl) valEl.textContent = valHtml;

    var canvasMap = window.StudioEngine.generateCanvasMap(text, validation);
    var mapEl = $("#studio-canvas-map");
    if (mapEl) mapEl.textContent = JSON.stringify(canvasMap, null, 2);

    var promptResult = window.StudioEngine.generateStudioPrompt(text, validation);
    state.lastStudioPrompt = promptResult.prompt;
    var promptEl = $("#studio-prompt");
    if (promptEl) promptEl.textContent = promptResult.prompt;
    var copyBtn = $("#studio-copy-prompt-btn");
    if (copyBtn) copyBtn.disabled = false;

    if (state.currentView === "chat") {
      appendSystemMessage(
        "Studio pipeline complete. Validation " + (validation.ok ? "passed" : "flagged") +
        ". Canvas map + 8K prompt ready in Creative Canvas view."
      );
    }
  }

  function showToast(message) {
    var existing = document.getElementById("studio-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.id = "studio-toast";
    toast.textContent = message;
    toast.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
      "background:#3d8bfd;color:#fff;padding:10px 18px;border-radius:8px;" +
      "font-family:system-ui,sans-serif;font-size:13px;z-index:200;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.35);";
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 1800);
  }

  function exportChat(format) {
    if (!enforceAttestation("export")) return;
    var lines = state.messages
      .filter(function (m) { return m.role !== "system"; })
      .map(function (m) {
        if (format === "md") {
          return "### " + m.role + (m.tool ? " \u00b7 `" + m.tool + "`" : "") + "\n\n" + m.text + "\n";
        }
        return "[" + m.role + "] " + m.text + "\n";
      });
    var body =
      format === "md"
        ? "# NNACC Session Export\n\n_Exported " + new Date().toISOString() + "_\n\n" + lines.join("\n")
        : "NNACC Session Export\nExported " + new Date().toISOString() + "\n\n" + lines.join("\n");

    var blob = new Blob([body], {
      type: format === "md" ? "text/markdown" : "text/plain",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "nnacc-session-" + Date.now() + "." + format;
    a.click();
    URL.revokeObjectURL(url);
  }

  function sealCurrentTranscript() {
    if (!enforceAttestation("OIAV seal")) return;
    var transcript = state.messages
      .filter(function (m) { return m.role !== "system"; })
      .map(function (m) {
        return { role: m.role, text: m.text, ts: m.ts, hash: m.hash };
      });
    var log = $("#oiav-log");
    if (log) {
      log.textContent =
        "OIAV seal requested (UI surface).\n" +
        "In production this calls the existing backend OIAV vault path with a Merkle root of the transcript.\n" +
        "Payload preview:\n" +
        JSON.stringify({ kind: "nnacc-transcript", count: transcript.length, sample: transcript.slice(0, 2) }, null, 2);
    }
    appendSystemMessage("OIAV seal request recorded. Connect a live backend Remote URL to perform real Merkle sealing.");
  }

  function switchView(viewId) {
    state.currentView = viewId;
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.remove("active");
    });
    var target = document.getElementById("view-" + viewId);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === viewId);
    });

    var titles = {
      chat: ["NNACC", "Engine 25 \u00b7 habitat-grounded \u00b7 NASE-gated"],
      usse: ["USSE Lab", "Engine 23 \u00b7 stress & simulation pipeline"],
      oiav: ["OIAV Vault", "Engine 24 \u00b7 Merkle-sealed asset protection"],
      registry: ["Engine Registry", "Engines 1\u201325 status surface"],
      studio: ["Creative Canvas", "25-engine validation \u00b7 Canvas Mapper \u00b7 8K Studio Prompt"],
    };
    var t = titles[viewId] || ["Ultimate Fix-It", ""];
    var titleEl = $("#view-title");
    var subEl = $("#view-subtitle");
    if (titleEl) titleEl.textContent = t[0];
    if (subEl) subEl.textContent = t[1];

    if (sidebar) sidebar.classList.remove("open");
  }

  function populateRegistry() {
    var engines = [
      { id: 1, name: "soft-body-physics" },
      { id: 2, name: "multi-agent-interaction" },
      { id: 3, name: "tcc-anomaly" },
      { id: 4, name: "cdem-diagnosis" },
      { id: 5, name: "rte-repair-plan" },
      { id: 23, name: "usse-stress" },
      { id: 24, name: "oiav-vault" },
      { id: 25, name: "nnacc-chat" },
      { id: "\u2026", name: "thermal / geometry / causal-fusion / nase-aegis / \u2026" },
    ];
    var list = $("#engine-list");
    if (!list) return;
    list.innerHTML = "";
    engines.forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + e.id + ". " + e.name + "</span><span class=\"status\">registered</span>";
      list.appendChild(li);
    });
  }

  function init() {
    refreshAttestation();
    loadSession();
    populateRegistry();

    if (state.messages.length === 0) {
      appendSystemMessage(
        "NNACC V2 + Creative Studio formal core ready. Tools are registry-bounded; mutations require NASE-fresh attestation (\u0394t \u2264 " +
          deltaSeconds +
          "s). Drop a specification, open Creative Canvas, or type a message."
      );
    }

    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.id === "open-settings") {
          if (settingsModal) settingsModal.hidden = false;
          return;
        }
        switchView(btn.dataset.view);
      });
    });

    var toggle = $("#sidebar-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        if (sidebar) {
          sidebar.classList.toggle("open");
          sidebar.classList.toggle("collapsed");
        }
      });
    }
    var closeBtn = $("#sidebar-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (sidebar) {
          sidebar.classList.remove("open");
          sidebar.classList.add("collapsed");
        }
      });
    }

    var sendBtn = $("#send-btn");
    if (sendBtn) {
      sendBtn.addEventListener("click", function () {
        var text = composer ? composer.value : "";
        if (composer) composer.value = "";
        sendMessage(text);
      });
    }
    if (composer) {
      composer.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (sendBtn) sendBtn.click();
        }
      });
    }

    var filePicker = $("#file-picker");
    if (filePicker) {
      filePicker.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) ingestFile(file);
        e.target.value = "";
      });
    }

    if (dropZone) {
      ["dragenter", "dragover"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropZone.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropZone.classList.remove("dragover");
        });
      });
      dropZone.addEventListener("drop", function (e) {
        var file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) ingestFile(file);
      });
    }

    var exportMd = $("#export-md");
    if (exportMd) exportMd.addEventListener("click", function () { exportChat("md"); });
    var exportTxt = $("#export-txt");
    if (exportTxt) exportTxt.addEventListener("click", function () { exportChat("txt"); });

    var runUsse = $("#run-usse-btn");
    if (runUsse) {
      runUsse.addEventListener("click", function () {
        if (!enforceAttestation("USSE run")) return;
        if (!state.pendingUssePayload) return;
        appendSystemMessage(
          "USSE stress payload dispatched (UI \u2192 bridge). On a live backend this POSTs to /jobs with validator_id=usse-stress.\n" +
            JSON.stringify(state.pendingUssePayload, null, 2)
        );
      });
    }

    var sealBtn = $("#seal-btn");
    if (sealBtn) sealBtn.addEventListener("click", sealCurrentTranscript);

    // ================================================================
    // Creative Studio event bindings (FINAL WIRING)
    // ================================================================
    var studioDrop = $("#studio-drop");
    var studioInput = $("#studio-input");

    var validateBtn = $("#studio-validate-btn");
    if (validateBtn) {
      validateBtn.addEventListener("click", function () {
        var text = studioInput ? (studioInput.value || "").trim() : "";
        if (!text) {
          var valEl = $("#studio-validation");
          if (valEl) valEl.textContent = "Provide a concept (text or file) before validating.";
          return;
        }
        runStudioPipeline(text, "studio-textarea");
      });
    }

    var copyPromptBtn = $("#studio-copy-prompt-btn");
    if (copyPromptBtn) {
      copyPromptBtn.addEventListener("click", function () {
        if (!state.lastStudioPrompt) {
          var text = studioInput ? (studioInput.value || "").trim() : "";
          if (text && window.StudioEngine) {
            if (!enforceAttestation("generate studio prompt")) return;
            var validation = state.lastStudioValidation || window.StudioEngine.evaluateConcept(text, "studio-input");
            var promptResult = window.StudioEngine.generateStudioPrompt(text, validation);
            state.lastStudioPrompt = promptResult.prompt;
            var promptEl = $("#studio-prompt");
            if (promptEl) promptEl.textContent = promptResult.prompt;
          } else {
            return;
          }
        }
        if (!enforceAttestation("copy studio prompt")) return;
        navigator.clipboard.writeText(state.lastStudioPrompt).then(function () {
          showToast("Prompt Copied!");
          var prev = copyPromptBtn.textContent;
          copyPromptBtn.textContent = "Copied \u2713";
          setTimeout(function () { copyPromptBtn.textContent = prev; }, 1400);
        });
      });
    }

    var studioFilePicker = $("#studio-file-picker");
    if (studioFilePicker) {
      studioFilePicker.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!enforceAttestation("studio file ingest")) return;
        file.text().then(function (text) {
          if (studioInput) studioInput.value = text;
          runStudioPipeline(text, file.name);
        });
        e.target.value = "";
      });
    }

    if (studioDrop) {
      ["dragenter", "dragover"].forEach(function (evt) {
        studioDrop.addEventListener(evt, function (e) {
          e.preventDefault();
          studioDrop.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        studioDrop.addEventListener(evt, function (e) {
          e.preventDefault();
          studioDrop.classList.remove("dragover");
        });
      });
      studioDrop.addEventListener("drop", function (e) {
        var file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        if (!enforceAttestation("studio drop")) return;
        file.text().then(function (text) {
          if (studioInput) studioInput.value = text;
          runStudioPipeline(text, file.name);
        });
      });
    }

    var closeSettings = $("#close-settings");
    if (closeSettings) {
      closeSettings.addEventListener("click", function () {
        if (settingsModal) settingsModal.hidden = true;
      });
    }
    var saveSettings = $("#save-settings");
    if (saveSettings) {
      saveSettings.addEventListener("click", function () {
        var d = parseFloat((("#setting-delta") && $("#setting-delta").value) || "30");
        if (!Number.isNaN(d) && d >= 5 && d <= 120) deltaSeconds = d;
        var remoteEl = $("#setting-remote");
        state.remoteUrl = remoteEl ? remoteEl.value.trim() : "";
        var autoEl = $("#setting-auto-usse");
        state.autoUsse = autoEl ? autoEl.checked : true;
        localStorage.setItem("nnacc-v2-remote", state.remoteUrl);
        localStorage.setItem("nnacc-v2-auto-usse", String(state.autoUsse));
        refreshAttestation();
        if (settingsModal) settingsModal.hidden = true;
        appendSystemMessage("Settings saved. NASE \u0394t = " + deltaSeconds + "s. Auto-USSE = " + state.autoUsse + ".");
      });
    }

    setInterval(updateAttestationUI, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
