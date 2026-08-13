/**
 * ui-controller.js — NNACC V2 shell controller + Creative Studio bindings
 *
 * CONNECTIVITY MAP (do not remove)
 * --------------------------------
 * Engine 25 (NNACC)  : primary chat surface, message list, composer
 * Engine 23 (USSE)   : delegates detection + payload build to usse-bridge.js
 * Engine 24 (OIAV)   : sealCurrentTranscript()
 * Studio (GEN)       : StudioEngine.evaluateConcept → generateCanvasMap → generateStudioPrompt
 * NASE Δt ≤ 30 s     : enforceAttestation() before every mutation
 * I5 non-escalation  : TOOL_ALLOWLIST hard gate
 *
 * Evidence class: Partially Verified (client-side heuristic studio loop).
 */

(function () {
  "use strict";

  const DEFAULT_DELTA_SECONDS = 30;
  let deltaSeconds = DEFAULT_DELTA_SECONDS;
  let attestationTimestamp = Date.now() / 1000;

  const TOOL_ALLOWLIST = new Set([
    "nnacc-chat", "usse-stress", "oiav-vault", "nase-aegis", "nadre-monitor",
    "soft-body-physics", "thermal-dissipation", "geometry-tolerance",
    "rte-repair-plan", "causal-fusion",
  ]);

  const state = {
    messages: [],
    currentView: "chat",
    remoteUrl: localStorage.getItem("nnacc-v2-remote") || "",
    autoUsse: localStorage.getItem("nnacc-v2-auto-usse") !== "false",
    pendingUssePayload: null,
    studioConceptText: "",
    studioSourceName: "pasted-concept",
    lastValidation: null,
    lastCanvasMap: null,
    lastStudioPrompt: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const messageList = $("#message-list");
  const composer = $("#composer-input");
  const dropZone = $("#drop-zone");
  const sidebar = $("#sidebar");
  const settingsModal = $("#settings-modal");
  const attestationStatus = $("#attestation-status");
  const attestationText = $("#attestation-text");

  const studioInput = $("#studio-input");
  const studioDrop = $("#studio-drop");
  const studioFilePicker = $("#studio-file-picker");
  const studioValidateBtn = $("#studio-validate-btn");
  const studioCopyPromptBtn = $("#studio-copy-prompt-btn");
  const studioValidationEl = $("#studio-validation");
  const studioCanvasMapEl = $("#studio-canvas-map");
  const studioPromptEl = $("#studio-prompt");

  function refreshAttestation() {
    attestationTimestamp = Date.now() / 1000;
    updateAttestationUI();
  }

  function checkAttestationFreshness() {
    const now = Date.now() / 1000;
    const age = now - attestationTimestamp;
    if (age > deltaSeconds) {
      return { ok: false, reason: `attestation stale: age=${age.toFixed(1)}s exceeds Δt=${deltaSeconds}s` };
    }
    return { ok: true, reason: `attestation fresh: age=${age.toFixed(1)}s ≤ Δt=${deltaSeconds}s` };
  }

  function enforceAttestation(actionLabel) {
    const result = checkAttestationFreshness();
    updateAttestationUI();
    if (!result.ok) {
      appendSystemMessage(`NASE blocked “${actionLabel}”: ${result.reason}. Refresh the page or open Settings to renew.`);
      return false;
    }
    return true;
  }

  function updateAttestationUI() {
    const result = checkAttestationFreshness();
    if (attestationStatus) attestationStatus.classList.toggle("stale", !result.ok);
    if (attestationText) attestationText.textContent = result.ok ? `Δt fresh (${deltaSeconds}s)` : "Δt STALE";
  }

  ["click", "keydown", "pointerdown"].forEach((evt) => {
    document.addEventListener(evt, () => {
      const age = Date.now() / 1000 - attestationTimestamp;
      if (age > deltaSeconds * 0.5) refreshAttestation();
    }, { passive: true });
  });

  function appendMessage({ role, text, tool, hash, actions }) {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const msg = { id, role, text, tool, hash, ts: Date.now(), actions };
    state.messages.push(msg);
    renderMessage(msg);
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
    persistSession();
    return msg;
  }

  function appendSystemMessage(text) {
    return appendMessage({ role: "system", text });
  }

  function renderMessage(msg) {
    if (!messageList) return;
    const el = document.createElement("div");
    el.className = `msg ${msg.role}`;
    el.dataset.id = msg.id;

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `<span>${msg.role}</span>`;
    if (msg.tool) meta.innerHTML += `<span>· ${msg.tool}</span>`;
    if (msg.hash) meta.innerHTML += `<span class="hash">${msg.hash}</span>`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(msg.text).then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      });
    });
    meta.appendChild(copyBtn);

    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = msg.text;

    el.appendChild(meta);
    el.appendChild(body);

    if (msg.actions && msg.actions.length) {
      msg.actions.forEach((action) => {
        const chip = document.createElement("button");
        chip.className = "action-chip";
        chip.textContent = action.label;
        chip.addEventListener("click", () => action.handler());
        el.appendChild(chip);
      });
    }

    messageList.appendChild(el);
  }

  async function shortHash(text) {
    try {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
    } catch {
      return String(text.length);
    }
  }

  function persistSession() {
    try {
      localStorage.setItem("nnacc-v2-session", JSON.stringify({
        updatedAt: Date.now(),
        messages: state.messages.filter((m) => m.role !== "system"),
      }));
    } catch { /* non-fatal */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem("nnacc-v2-session");
      if (!raw) return;
      const data = JSON.parse(raw);
      (data.messages || []).forEach((m) => {
        state.messages.push(m);
        renderMessage(m);
      });
    } catch { /* ignore */ }
  }

  async function sendMessage(text) {
    if (!text || !text.trim()) return;
    if (!enforceAttestation("chat send")) return;

    const trimmed = text.trim();
    const userHash = await shortHash(`user:${trimmed}:${Date.now()}`);
    appendMessage({ role: "user", text: trimmed, hash: userHash });

    let tool = null;
    const lower = trimmed.toLowerCase();
    if (/\b(usse|stress|torque|load\s*lb|400\s*lb|500\s*lb)\b/i.test(lower)) tool = "usse-stress";
    else if (/\b(oiav|vault|seal|copyright|patent)\b/i.test(lower)) tool = "oiav-vault";
    else if (/\b(nase|attestation|gateway)\b/i.test(lower)) tool = "nase-aegis";
    else if (/\b(nadre|self-?heal|memory\s*pressure)\b/i.test(lower)) tool = "nadre-monitor";

    if (tool && !TOOL_ALLOWLIST.has(tool)) {
      appendSystemMessage(`I5 non-escalation: tool “${tool}” is not on the allow-list. Refused.`);
      return;
    }

    let reply;
    const actions = [];

    if (tool === "usse-stress") {
      reply = "Routing proposal → **usse-stress** (Engine 23). NASE attestation is fresh. I can build a stress payload from the current context. Use the action chip or open the USSE Lab.";
      actions.push({
        label: "⚡ Incentivize / Run USSE Stress Test",
        handler: () => {
          if (!enforceAttestation("USSE dispatch")) return;
          const payload = window.USSEBridge ? window.USSEBridge.buildFromText(trimmed) : { force_n: 0, load_lb: 400, note: "fallback" };
          state.pendingUssePayload = payload;
          const prev = $("#usse-preview");
          if (prev) prev.textContent = JSON.stringify(payload, null, 2);
          const runBtn = $("#run-usse-btn");
          if (runBtn) runBtn.disabled = false;
          switchView("usse");
        },
      });
    } else if (tool === "oiav-vault") {
      reply = "Routing proposal → **oiav-vault** (Engine 24). Ready to Merkle-seal the current transcript when you confirm.";
      actions.push({ label: "🔒 Seal transcript in OIAV", handler: () => sealCurrentTranscript() });
    } else if (tool) {
      reply = `Routing proposal → **${tool}**. NASE attestation fresh. On a live backend this would submit a structured job via the Remote path.`;
    } else if (/(hello|hi|hey|help)/i.test(lower)) {
      reply = "NNACC V2 online. I ground turns in the habitat, gate tools with NASE (Δt ≤ " + deltaSeconds + "s), and refuse privilege escalation. Drop a .md/.txt physics or game spec to auto-route into USSE, or open Creative Canvas for 25-engine concept validation + 8K studio prompts.";
    } else {
      reply = "Acknowledged. No diagnostic tool intent matched. Message recorded under the session trail. Try “run USSE on 400 lb load”, “seal IP in OIAV”, open Creative Canvas, or drop a specification file.";
    }

    const aHash = await shortHash(`assistant:${reply}:${Date.now()}`);
    appendMessage({ role: "assistant", text: reply, tool, hash: aHash, actions });
  }

  async function ingestFile(file) {
    if (!enforceAttestation("file ingest")) return;
    const name = file.name || "untitled";
    const text = await file.text();

    appendMessage({
      role: "user",
      text: `[File ingested: ${name}]\n\n${text.slice(0, 4000)}${text.length > 4000 ? "\n…(truncated for display)" : ""}`,
      hash: await shortHash(name + text.slice(0, 200)),
    });

    if (state.autoUsse && window.USSEBridge && window.USSEBridge.looksLikeSpec(text, name)) {
      const payload = window.USSEBridge.parseSpec(text, name);
      state.pendingUssePayload = payload;
      const prev = $("#usse-preview");
      if (prev) prev.textContent = JSON.stringify(payload, null, 2);
      const runBtn = $("#run-usse-btn");
      if (runBtn) runBtn.disabled = false;

      appendMessage({
        role: "assistant",
        text: `Detected a specification-like document (“${name}”). Engine 23 (USSE) payload has been prepared. NASE attestation is fresh.`,
        tool: "usse-stress",
        actions: [{
          label: "⚡ Incentivize / Run USSE Stress Test",
          handler: () => {
            if (!enforceAttestation("USSE dispatch")) return;
            switchView("usse");
          },
        }],
      });
    } else {
      appendMessage({
        role: "assistant",
        text: `File “${name}” stored in session context. No USSE signals detected (or auto-detect is off).`,
      });
    }
  }

  function exportChat(format) {
    if (!enforceAttestation("export")) return;
    const lines = state.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (format === "md") return `### ${m.role}${m.tool ? ` · \`${m.tool}\`` : ""}\n\n${m.text}\n`;
        return `[${m.role}] ${m.text}\n`;
      });
    const body = format === "md"
      ? `# NNACC Session Export\n\n_Exported ${new Date().toISOString()}_\n\n${lines.join("\n")}`
      : `NNACC Session Export\nExported ${new Date().toISOString()}\n\n${lines.join("\n")}`;

    const blob = new Blob([body], { type: format === "md" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nnacc-session-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function sealCurrentTranscript() {
    if (!enforceAttestation("OIAV seal")) return;
    const transcript = state.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, text: m.text, ts: m.ts, hash: m.hash }));
    const log = $("#oiav-log");
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
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewId);
    });

    const titles = {
      chat: ["NNACC", "Engine 25 · habitat-grounded · NASE-gated"],
      usse: ["USSE Lab", "Engine 23 · stress & simulation pipeline"],
      oiav: ["OIAV Vault", "Engine 24 · Merkle-sealed asset protection"],
      registry: ["Engine Registry", "Engines 1–25 status surface"],
      studio: ["Creative Canvas", "Genesis · 25-engine validation · Canvas Mapper · 8K Studio Prompt"],
    };
    const t = titles[viewId] || ["Ultimate Fix-It", ""];
    const titleEl = $("#view-title");
    const subEl = $("#view-subtitle");
    if (titleEl) titleEl.textContent = t[0];
    if (subEl) subEl.textContent = t[1];

    if (sidebar) sidebar.classList.remove("open");
  }

  function populateRegistry() {
    const engines = [
      { id: 1, name: "soft-body-physics" },
      { id: 2, name: "multi-agent-interaction" },
      { id: 3, name: "tcc-anomaly" },
      { id: 4, name: "cdem-diagnosis" },
      { id: 5, name: "rte-repair-plan" },
      { id: 23, name: "usse-stress" },
      { id: 24, name: "oiav-vault" },
      { id: 25, name: "nnacc-chat" },
      { id: "…", name: "thermal / geometry / causal-fusion / nase-aegis / …" },
    ];
    const list = $("#engine-list");
    if (!list) return;
    list.innerHTML = "";
    engines.forEach((e) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${e.id}. ${e.name}</span><span class="status">registered</span>`;
      list.appendChild(li);
    });
  }

  function showToast(message, ms = 2200) {
    let toast = document.getElementById("nnacc-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "nnacc-toast";
      toast.setAttribute("role", "status");
      toast.style.cssText =
        "position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);" +
        "background:rgba(18,24,32,.92);color:#e8eef6;border:1px solid rgba(61,139,253,.35);" +
        "padding:10px 18px;border-radius:999px;font-family:system-ui,sans-serif;font-size:13px;" +
        "z-index:200;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;" +
        "box-shadow:0 8px 28px rgba(0,0,0,.45);backdrop-filter:blur(10px);";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(20px)";
    }, ms);
  }

  function formatValidationBlock(validation) {
    if (!validation) return "Awaiting concept…";
    const lines = [];
    lines.push(`Status: ${validation.ok ? "PASS" : "BLOCKED"}`);
    lines.push(`Summary: ${validation.summary}`);
    lines.push(`Source: ${validation.source} (${validation.length} chars)`);
    lines.push(`Engines hit: ${(validation.enginesHit || []).join(", ") || "none"}`);
    lines.push(`Timestamp: ${validation.timestamp}`);
    if (validation.flags && validation.flags.length) {
      lines.push("");
      lines.push("Flags:");
      validation.flags.forEach((f) => {
        lines.push(`  [${f.severity.toUpperCase()}] ${f.engine} · ${f.code}`);
        lines.push(`    ${f.message}`);
      });
    } else {
      lines.push("");
      lines.push("Flags: none");
    }
    return lines.join("\n");
  }

  function formatCanvasMapBlock(map) {
    if (!map) return "—";
    return JSON.stringify(map, null, 2);
  }

  function runStudioPipeline() {
    if (!enforceAttestation("studio validate")) return;
    if (!window.StudioEngine) {
      if (studioValidationEl) studioValidationEl.textContent = "StudioEngine not loaded.";
      showToast("StudioEngine missing");
      return;
    }

    const text = (state.studioConceptText || (studioInput && studioInput.value) || "").trim();
    if (!text) {
      showToast("Paste or drop a concept first");
      if (studioValidationEl) studioValidationEl.textContent = "No concept text provided.";
      return;
    }

    state.studioConceptText = text;
    const source = state.studioSourceName || "pasted-concept";

    const validation = window.StudioEngine.evaluateConcept(text, source);
    state.lastValidation = validation;
    if (studioValidationEl) studioValidationEl.textContent = formatValidationBlock(validation);

    const canvasMap = window.StudioEngine.generateCanvasMap(text, validation);
    state.lastCanvasMap = canvasMap;
    if (studioCanvasMapEl) studioCanvasMapEl.textContent = formatCanvasMapBlock(canvasMap);

    const promptResult = window.StudioEngine.generateStudioPrompt(text, validation);
    state.lastStudioPrompt = promptResult;
    if (studioPromptEl) studioPromptEl.textContent = promptResult.prompt;

    if (studioCopyPromptBtn) studioCopyPromptBtn.disabled = !promptResult.prompt;

    showToast(validation.ok ? "Validated & canvas mapped" : "Flags raised — map still generated");
  }

  function copyStudioPrompt() {
    if (!enforceAttestation("studio prompt copy")) return;
    const prompt =
      (state.lastStudioPrompt && state.lastStudioPrompt.prompt) ||
      (studioPromptEl && studioPromptEl.textContent) ||
      "";
    if (!prompt || prompt === "—") {
      showToast("No prompt to copy");
      return;
    }
    navigator.clipboard.writeText(prompt).then(() => {
      showToast("Prompt Copied!");
      if (studioCopyPromptBtn) {
        const prev = studioCopyPromptBtn.textContent;
        studioCopyPromptBtn.textContent = "Copied!";
        setTimeout(() => { studioCopyPromptBtn.textContent = prev; }, 1400);
      }
    }).catch(() => {
      showToast("Clipboard blocked — select text manually");
    });
  }

  async function ingestStudioFile(file) {
    if (!enforceAttestation("studio file ingest")) return;
    const name = file.name || "uploaded-concept";
    const text = await file.text();
    state.studioConceptText = text;
    state.studioSourceName = name;
    if (studioInput) studioInput.value = text;
    showToast(`Loaded “${name}”`);
  }

  function wireStudioEvents() {
    if (!studioValidateBtn && !studioInput) return;

    if (studioInput) {
      studioInput.addEventListener("input", () => {
        state.studioConceptText = studioInput.value;
        state.studioSourceName = "pasted-concept";
      });
    }

    if (studioValidateBtn) {
      studioValidateBtn.addEventListener("click", () => {
        if (studioInput) state.studioConceptText = studioInput.value;
        runStudioPipeline();
      });
    }

    if (studioCopyPromptBtn) {
      studioCopyPromptBtn.addEventListener("click", copyStudioPrompt);
    }

    if (studioFilePicker) {
      studioFilePicker.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) ingestStudioFile(file);
        e.target.value = "";
      });
    }

    if (studioDrop) {
      ["dragenter", "dragover"].forEach((evt) => {
        studioDrop.addEventListener(evt, (e) => {
          e.preventDefault();
          studioDrop.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((evt) => {
        studioDrop.addEventListener(evt, (e) => {
          e.preventDefault();
          studioDrop.classList.remove("dragover");
        });
      });
      studioDrop.addEventListener("drop", (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) ingestStudioFile(file);
      });
    }
  }

  function init() {
    refreshAttestation();
    loadSession();
    populateRegistry();

    if (state.messages.length === 0) {
      appendSystemMessage(
        "NNACC V2 formal core ready. Tools are registry-bounded; mutations require NASE-fresh attestation (Δt ≤ " +
          deltaSeconds +
          "s). Drop a specification or open Creative Canvas (Section B) for 25-engine validation + 8K studio prompts."
      );
    }

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.id === "open-settings") {
          if (settingsModal) settingsModal.hidden = false;
          return;
        }
        const view = btn.dataset.view;
        if (view && view !== "settings") switchView(view);
      });
    });

    const sidebarToggle = $("#sidebar-toggle");
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", () => {
        if (sidebar) {
          sidebar.classList.toggle("open");
          sidebar.classList.toggle("collapsed");
        }
      });
    }
    const sidebarClose = $("#sidebar-close");
    if (sidebarClose) {
      sidebarClose.addEventListener("click", () => {
        if (sidebar) {
          sidebar.classList.remove("open");
          sidebar.classList.add("collapsed");
        }
      });
    }

    const sendBtn = $("#send-btn");
    if (sendBtn) {
      sendBtn.addEventListener("click", () => {
        const text = composer ? composer.value : "";
        if (composer) composer.value = "";
        sendMessage(text);
      });
    }
    if (composer) {
      composer.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (sendBtn) sendBtn.click();
        }
      });
    }

    const filePicker = $("#file-picker");
    if (filePicker) {
      filePicker.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) ingestFile(file);
        e.target.value = "";
      });
    }

    if (dropZone) {
      ["dragenter", "dragover"].forEach((evt) => {
        dropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropZone.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((evt) => {
        dropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropZone.classList.remove("dragover");
        });
      });
      dropZone.addEventListener("drop", (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) ingestFile(file);
      });
    }

    const exportMd = $("#export-md");
    const exportTxt = $("#export-txt");
    if (exportMd) exportMd.addEventListener("click", () => exportChat("md"));
    if (exportTxt) exportTxt.addEventListener("click", () => exportChat("txt"));

    const runUsseBtn = $("#run-usse-btn");
    if (runUsseBtn) {
      runUsseBtn.addEventListener("click", () => {
        if (!enforceAttestation("USSE run")) return;
        if (!state.pendingUssePayload) return;
        appendSystemMessage(
          "USSE stress payload dispatched (UI → bridge). On a live backend this POSTs to /jobs with validator_id=usse-stress.\n" +
            JSON.stringify(state.pendingUssePayload, null, 2)
        );
      });
    }

    const sealBtn = $("#seal-btn");
    if (sealBtn) sealBtn.addEventListener("click", sealCurrentTranscript);

    const closeSettings = $("#close-settings");
    if (closeSettings) {
      closeSettings.addEventListener("click", () => {
        if (settingsModal) settingsModal.hidden = true;
      });
    }
    const saveSettings = $("#save-settings");
    if (saveSettings) {
      saveSettings.addEventListener("click", () => {
        const d = parseFloat(($("#setting-delta") || {}).value);
        if (!Number.isNaN(d) && d >= 5 && d <= 120) deltaSeconds = d;
        const remoteEl = $("#setting-remote");
        const autoEl = $("#setting-auto-usse");
        state.remoteUrl = remoteEl ? remoteEl.value.trim() : "";
        state.autoUsse = autoEl ? autoEl.checked : true;
        localStorage.setItem("nnacc-v2-remote", state.remoteUrl);
        localStorage.setItem("nnacc-v2-auto-usse", String(state.autoUsse));
        refreshAttestation();
        if (settingsModal) settingsModal.hidden = true;
        appendSystemMessage(`Settings saved. NASE Δt = ${deltaSeconds}s. Auto-USSE = ${state.autoUsse}.`);
      });
    }

    wireStudioEvents();
    setInterval(updateAttestationUI, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
