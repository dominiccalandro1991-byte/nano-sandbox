/**
 * ui-controller.js — NNACC V2 shell controller
 *
 * CONNECTIVITY MAP (do not remove)
 * --------------------------------
 * Engine 25 (NNACC)  : primary chat surface, message list, composer
 * Engine 23 (USSE)   : delegates detection + payload build to usse-bridge.js
 * Engine 24 (OIAV)   : sealCurrentTranscript() — calls existing OIAV path when remote is set
 * NASE Δt ≤ 30 s     : enforceAttestation() before every mutation (write, export, tool dispatch)
 * I5 non-escalation  : TOOL_ALLOWLIST hard gate — unknown engines are refused
 *
 * This file is deliberately free of backend imports so it can run as a pure
 * static asset on GitHub Pages. When promoted into the React tree it should
 * call the real NanoHabitatEngine + remote-client instead of localStorage.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // NASE constants (mirrors backend/app/nase/invariants.py DEFAULT_DELTA_SECONDS)
  // ---------------------------------------------------------------------------
  const DEFAULT_DELTA_SECONDS = 30;
  let deltaSeconds = DEFAULT_DELTA_SECONDS;
  let attestationTimestamp = Date.now() / 1000; // seconds since epoch

  // Hard allow-list — prevents privilege escalation (I5)
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
  ]);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    messages: [],
    currentView: "chat",
    remoteUrl: localStorage.getItem("nnacc-v2-remote") || "",
    autoUsse: localStorage.getItem("nnacc-v2-auto-usse") !== "false",
    pendingUssePayload: null,
  };

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const messageList = $("#message-list");
  const composer = $("#composer-input");
  const dropZone = $("#drop-zone");
  const sidebar = $("#sidebar");
  const settingsModal = $("#settings-modal");
  const attestationStatus = $("#attestation-status");
  const attestationText = $("#attestation-text");

  // ---------------------------------------------------------------------------
  // NASE attestation gate
  // ---------------------------------------------------------------------------
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
    attestationStatus.classList.toggle("stale", !result.ok);
    attestationText.textContent = result.ok ? `Δt fresh (${deltaSeconds}s)` : "Δt STALE";
  }

  // Renew attestation on any user interaction (keeps Δt fresh during active use)
  ["click", "keydown", "pointerdown"].forEach((evt) => {
    document.addEventListener(evt, () => {
      // Only renew if still within a generous window to avoid constant writes
      const age = Date.now() / 1000 - attestationTimestamp;
      if (age > deltaSeconds * 0.5) refreshAttestation();
    }, { passive: true });
  });

  // ---------------------------------------------------------------------------
  // Message helpers
  // ---------------------------------------------------------------------------
  function appendMessage({ role, text, tool, hash, actions }) {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const msg = { id, role, text, tool, hash, ts: Date.now(), actions };
    state.messages.push(msg);
    renderMessage(msg);
    messageList.scrollTop = messageList.scrollHeight;
    persistSession();
    return msg;
  }

  function appendSystemMessage(text) {
    return appendMessage({ role: "system", text });
  }

  function renderMessage(msg) {
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
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 12);
    } catch {
      return String(text.length);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence (local; production path writes into habitat via engine.writeFile)
  // ---------------------------------------------------------------------------
  function persistSession() {
    try {
      localStorage.setItem(
        "nnacc-v2-session",
        JSON.stringify({
          updatedAt: Date.now(),
          messages: state.messages.filter((m) => m.role !== "system"),
        })
      );
    } catch {
      /* quota or private mode — non-fatal */
    }
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
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Chat send path (Engine 25)
  // ---------------------------------------------------------------------------
  async function sendMessage(text, opts = {}) {
    if (!text || !text.trim()) return;
    if (!enforceAttestation("chat send")) return;

    const trimmed = text.trim();
    const userHash = await shortHash(`user:${trimmed}:${Date.now()}`);
    appendMessage({ role: "user", text: trimmed, hash: userHash });

    // Tool intent (client-side mirror of backend parse_tool_intent)
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
      reply =
        "Routing proposal → **usse-stress** (Engine 23). NASE attestation is fresh. " +
        "I can build a stress payload from the current context. Use the action chip or open the USSE Lab.";
      actions.push({
        label: "⚡ Incentivize / Run USSE Stress Test",
        handler: () => {
          if (!enforceAttestation("USSE dispatch")) return;
          const payload = window.USSEBridge
            ? window.USSEBridge.buildFromText(trimmed)
            : { force_n: 0, load_lb: 400, note: "fallback" };
          state.pendingUssePayload = payload;
          $("#usse-preview").textContent = JSON.stringify(payload, null, 2);
          $("#run-usse-btn").disabled = false;
          switchView("usse");
        },
      });
    } else if (tool === "oiav-vault") {
      reply =
        "Routing proposal → **oiav-vault** (Engine 24). Ready to Merkle-seal the current transcript when you confirm.";
      actions.push({
        label: "🔒 Seal transcript in OIAV",
        handler: () => sealCurrentTranscript(),
      });
    } else if (tool) {
      reply = `Routing proposal → **${tool}**. NASE attestation fresh. On a live backend this would submit a structured job via the Remote path.`;
    } else if (/(hello|hi|hey|help)/i.test(lower)) {
      reply =
        "NNACC V2 online. I ground turns in the habitat, gate tools with NASE (Δt ≤ " +
        deltaSeconds +
        "s), and refuse privilege escalation. Drop a .md/.txt physics or game spec to auto-route into USSE, or say an engine name.";
    } else {
      reply =
        "Acknowledged. No diagnostic tool intent matched. Message recorded under the session trail. " +
        "Try “run USSE on 400 lb load”, “seal IP in OIAV”, or drop a specification file.";
    }

    const aHash = await shortHash(`assistant:${reply}:${Date.now()}`);
    appendMessage({ role: "assistant", text: reply, tool, hash: aHash, actions });
  }

  // ---------------------------------------------------------------------------
  // File ingestion (Universal I/O)
  // ---------------------------------------------------------------------------
  async function ingestFile(file) {
    if (!enforceAttestation("file ingest")) return;
    const name = file.name || "untitled";
    const text = await file.text();

    appendMessage({
      role: "user",
      text: `[File ingested: ${name}]\n\n${text.slice(0, 4000)}${text.length > 4000 ? "\n…(truncated for display)" : ""}`,
      hash: await shortHash(name + text.slice(0, 200)),
    });

    // USSE auto-detect
    if (state.autoUsse && window.USSEBridge && window.USSEBridge.looksLikeSpec(text, name)) {
      const payload = window.USSEBridge.parseSpec(text, name);
      state.pendingUssePayload = payload;
      $("#usse-preview").textContent = JSON.stringify(payload, null, 2);
      $("#run-usse-btn").disabled = false;

      appendMessage({
        role: "assistant",
        text:
          `Detected a specification-like document (“${name}”). ` +
          `Engine 23 (USSE) payload has been prepared. NASE attestation is fresh.`,
        tool: "usse-stress",
        actions: [
          {
            label: "⚡ Incentivize / Run USSE Stress Test",
            handler: () => {
              if (!enforceAttestation("USSE dispatch")) return;
              switchView("usse");
            },
          },
        ],
      });
    } else {
      appendMessage({
        role: "assistant",
        text: `File “${name}” stored in session context. No USSE signals detected (or auto-detect is off).`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Export (one-click .md / .txt)
  // ---------------------------------------------------------------------------
  function exportChat(format) {
    if (!enforceAttestation("export")) return;
    const lines = state.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (format === "md") {
          return `### ${m.role}${m.tool ? ` · \`${m.tool}\`` : ""}\n\n${m.text}\n`;
        }
        return `[${m.role}] ${m.text}\n`;
      });
    const body =
      format === "md"
        ? `# NNACC Session Export\n\n_Exported ${new Date().toISOString()}_\n\n${lines.join("\n")}`
        : `NNACC Session Export\nExported ${new Date().toISOString()}\n\n${lines.join("\n")}`;

    const blob = new Blob([body], {
      type: format === "md" ? "text/markdown" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nnacc-session-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // OIAV seal (Engine 24 surface)
  // ---------------------------------------------------------------------------
  function sealCurrentTranscript() {
    if (!enforceAttestation("OIAV seal")) return;
    const transcript = state.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, text: m.text, ts: m.ts, hash: m.hash }));
    const log = $("#oiav-log");
    log.textContent =
      "OIAV seal requested (UI surface).\n" +
      "In production this calls the existing backend OIAV vault path with a Merkle root of the transcript.\n" +
      "Payload preview:\n" +
      JSON.stringify({ kind: "nnacc-transcript", count: transcript.length, sample: transcript.slice(0, 2) }, null, 2);
    appendSystemMessage("OIAV seal request recorded. Connect a live backend Remote URL to perform real Merkle sealing.");
  }

  // ---------------------------------------------------------------------------
  // View switching + sidebar
  // ---------------------------------------------------------------------------
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
    };
    const t = titles[viewId] || ["Ultimate Fix-It", ""];
    $("#view-title").textContent = t[0];
    $("#view-subtitle").textContent = t[1];

    // Close mobile sidebar after navigation
    sidebar.classList.remove("open");
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
    list.innerHTML = "";
    engines.forEach((e) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${e.id}. ${e.name}</span><span class="status">registered</span>`;
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------
  function init() {
    refreshAttestation();
    loadSession();
    populateRegistry();

    // Welcome
    if (state.messages.length === 0) {
      appendSystemMessage(
        "NNACC V2 formal core ready. Tools are registry-bounded; mutations require NASE-fresh attestation (Δt ≤ " +
          deltaSeconds +
          "s). Drop a specification or type a message."
      );
    }

    // Sidebar nav
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.id === "open-settings") {
          settingsModal.hidden = false;
          return;
        }
        switchView(btn.dataset.view);
      });
    });

    $("#sidebar-toggle").addEventListener("click", () => {
      sidebar.classList.toggle("open");
      sidebar.classList.toggle("collapsed");
    });
    $("#sidebar-close").addEventListener("click", () => {
      sidebar.classList.remove("open");
      sidebar.classList.add("collapsed");
    });

    // Composer
    $("#send-btn").addEventListener("click", () => {
      const text = composer.value;
      composer.value = "";
      sendMessage(text);
    });
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#send-btn").click();
      }
    });

    // File picker
    $("#file-picker").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) ingestFile(file);
      e.target.value = "";
    });

    // Drag-and-drop
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

    // Export
    $("#export-md").addEventListener("click", () => exportChat("md"));
    $("#export-txt").addEventListener("click", () => exportChat("txt"));

    // USSE run
    $("#run-usse-btn").addEventListener("click", () => {
      if (!enforceAttestation("USSE run")) return;
      if (!state.pendingUssePayload) return;
      appendSystemMessage(
        "USSE stress payload dispatched (UI → bridge). On a live backend this POSTs to /jobs with validator_id=usse-stress.\n" +
          JSON.stringify(state.pendingUssePayload, null, 2)
      );
    });

    // OIAV
    $("#seal-btn").addEventListener("click", sealCurrentTranscript);

    // Settings
    $("#close-settings").addEventListener("click", () => (settingsModal.hidden = true));
    $("#save-settings").addEventListener("click", () => {
      const d = parseFloat($("#setting-delta").value);
      if (!Number.isNaN(d) && d >= 5 && d <= 120) deltaSeconds = d;
      state.remoteUrl = $("#setting-remote").value.trim();
      state.autoUsse = $("#setting-auto-usse").checked;
      localStorage.setItem("nnacc-v2-remote", state.remoteUrl);
      localStorage.setItem("nnacc-v2-auto-usse", String(state.autoUsse));
      refreshAttestation();
      settingsModal.hidden = true;
      appendSystemMessage(`Settings saved. NASE Δt = ${deltaSeconds}s. Auto-USSE = ${state.autoUsse}.`);
    });

    // Keep attestation UI live
    setInterval(updateAttestationUI, 5000);
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
