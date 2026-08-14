/**
 * engine-router.js — Voltage Cipher Studio dispatcher
 * 25 engines + 5 personas · live NASE backend · mock stream fallback
 */
(function (global) {
  "use strict";

  var DEFAULT_BACKEND = "https://nano-sandbox-api.onrender.com";

  var ENGINE_REGISTRY = [
    { id: 1, name: "soft-body-physics", group: "research", label: "E1 · Soft Body Physics" },
    { id: 2, name: "multi-agent-interaction", group: "research", label: "E2 · Multi-Agent Interaction" },
    { id: 3, name: "tcc-anomaly", group: "research", label: "E3 · TCC Anomaly" },
    { id: 4, name: "cdem-diagnosis", group: "research", label: "E4 · CDEM Diagnosis" },
    { id: 5, name: "rte-repair-plan", group: "research", label: "E5 · RTE Repair Plan" },
    { id: 6, name: "tier-drift", group: "inventor", label: "E6 · Tier Drift" },
    { id: 7, name: "physics-qc-matrix", group: "inventor", label: "E7 · Physics QC Matrix" },
    { id: 8, name: "dependency-collision", group: "inventor", label: "E8 · Dependency Collision" },
    { id: 9, name: "market-absence", group: "inventor", label: "E9 · Market Absence" },
    { id: 10, name: "thermal-dissipation", group: "inventor", label: "E10 · Thermal Dissipation" },
    { id: 11, name: "geometry-tolerance", group: "coder", label: "E11 · Geometry Tolerance" },
    { id: 12, name: "causal-fusion", group: "coder", label: "E12 · Causal Fusion" },
    { id: 13, name: "spectral-acoustic", group: "coder", label: "E13 · Spectral Acoustic" },
    { id: 14, name: "bayesian-causal", group: "coder", label: "E14 · Bayesian Causal" },
    { id: 15, name: "multi-modal-vision", group: "coder", label: "E15 · Multi-Modal Vision" },
    { id: 16, name: "deploy-ios", group: "deploy", label: "E16 · Deploy iOS" },
    { id: 17, name: "deploy-android", group: "deploy", label: "E17 · Deploy Android" },
    { id: 18, name: "deploy-pages", group: "deploy", label: "E18 · Deploy GitHub Pages" },
    { id: 19, name: "deploy-vercel", group: "deploy", label: "E19 · Deploy Vercel" },
    { id: 20, name: "deploy-orchestrator", group: "deploy", label: "E20 · Deploy Orchestrator" },
    { id: 21, name: "chat-persona", group: "chat", label: "E21 · Chat Persona" },
    { id: 22, name: "chat-grounding", group: "chat", label: "E22 · Chat Grounding" },
    { id: 23, name: "usse-stress", group: "labs", label: "E23 · USSE Stress Lab" },
    { id: 24, name: "oiav-vault", group: "labs", label: "E24 · OIAV Vault" },
    { id: 25, name: "nnacc-chat", group: "labs", label: "E25 · NASE Core / NNACC" }
  ];

  var PERSONAS = [
    {
      id: "vail-cipher",
      name: "Vail Cipher",
      tagline: "NASE Core & Cryptographic Encryption",
      engineIds: [25, 24, 3],
      macro: "chat",
      accent: "#00ff9d",
      glyph: "🔐"
    },
    {
      id: "backroad-voltage",
      name: "BackRoad Voltage",
      tagline: "High-Power Multi-Model Router",
      engineIds: [12, 14, 20, 25],
      macro: "research",
      accent: "#5b8cff",
      glyph: "⚡"
    },
    {
      id: "funkastatic",
      name: "Funkastatic",
      tagline: "Creative Canvas & Prompt Genesis",
      engineIds: [15, 13, 21],
      macro: "coder",
      accent: "#c084fc",
      glyph: "🎨"
    },
    {
      id: "aisle-nine",
      name: "Aisle Nine",
      tagline: "Heavy Mechanics & Inventor · 300–500 lb Utility",
      engineIds: [6, 7, 8, 9, 10],
      macro: "inventor",
      accent: "#ffb700",
      glyph: "⚙️"
    },
    {
      id: "dj-fault-line",
      name: "DJ Fault Line",
      tagline: "USSE Stress Lab & Telemetry",
      engineIds: [23, 1, 10],
      macro: "research",
      accent: "#ff3366",
      glyph: "📡"
    }
  ];

  var GROUP_LABELS = {
    research: "Macro 1 · Research (E1–5)",
    inventor: "Macro 2 · Inventor (E6–10)",
    coder: "Macro 3 · Coder (E11–15)",
    deploy: "Macro 4 · Deploy (E16–20)",
    chat: "Macro 5 · Chat (E21–22)",
    labs: "Specialized · USSE / OIAV / NASE (E23–25)"
  };

  function backendBase() {
    try {
      if (global.__NNACC_REMOTE__ && /^https?:\/\//i.test(global.__NNACC_REMOTE__)) {
        return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      }
      var s = localStorage.getItem("nnacc-v2-remote") || localStorage.getItem("vcs-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return DEFAULT_BACKEND;
  }

  function resolveTarget(targetKey) {
    if (!targetKey) return { kind: "engine", engine: ENGINE_REGISTRY[24], persona: null };
    if (targetKey.indexOf("persona:") === 0) {
      var pid = targetKey.slice(8);
      var persona = PERSONAS.filter(function (p) {
        return p.id === pid;
      })[0];
      return { kind: "persona", persona: persona || PERSONAS[0], engine: null };
    }
    var n = parseInt(String(targetKey).replace(/\D/g, ""), 10);
    var eng =
      ENGINE_REGISTRY.filter(function (e) {
        return e.id === n;
      })[0] || ENGINE_REGISTRY[24];
    return { kind: "engine", engine: eng, persona: null };
  }

  /** Extract display text; log hash receipts separately */
  function unpackResponse(data) {
    var text = "";
    var hash = null;
    var codeBlocks = [];
    if (data == null) return { text: "(empty response)", hash: null, codeBlocks: [], raw: data };
    if (typeof data === "string") {
      text = data;
    } else if (typeof data === "object") {
      hash =
        data.hash ||
        data.s_attest ||
        data.attestation_signature ||
        (data.attestation && data.attestation.s_attest) ||
        null;
      if (typeof data.result === "string") text = data.result;
      else if (typeof data.content === "string") text = data.content;
      else if (typeof data.message === "string") text = data.message;
      else if (data.result && typeof data.result === "object") {
        if (data.result.findings) text = data.result.findings.join("\n");
        else if (data.result.role) text = data.result.role + "\n" + JSON.stringify(data.result, null, 2);
        else text = JSON.stringify(data.result, null, 2);
      } else if (data.macro_engine) {
        text =
          "**" +
          data.macro_engine +
          "** · " +
          (data.status || "") +
          "\n" +
          (data.execution_ms != null ? "execution_ms: " + data.execution_ms + "\n" : "") +
          (data.result && data.result.findings
            ? data.result.findings.join("\n")
            : JSON.stringify(data.result || {}, null, 2));
      } else {
        text = JSON.stringify(data, null, 2);
      }
      if (hash) {
        try {
          console.info("[VCS] attestation/hash receipt:", hash);
        } catch (e) {}
      }
    }
    var re = /```([\w-]*)\n([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text))) {
      codeBlocks.push({ lang: m[1] || "", code: m[2] });
    }
    return { text: text, hash: hash, codeBlocks: codeBlocks, raw: data };
  }

  function mockStreamText(target, userMessage) {
    var name =
      target.kind === "persona"
        ? target.persona.name
        : "Engine " + target.engine.id + " (" + target.engine.name + ")";
    var lines = [];
    if (target.kind === "persona") {
      lines.push("**" + target.persona.name + "** online — " + target.persona.tagline + ".");
      lines.push("");
      lines.push("Received: _" + userMessage + "_");
      lines.push("");
      if (target.persona.id === "aisle-nine") {
        lines.push("Utility transport constraint remains **300–500 lb** mass band.");
        lines.push("Routing through Inventor macro (φ6–φ10) for structural pass.");
        lines.push("");
        lines.push("```json");
        lines.push(
          JSON.stringify(
            { utility_mass_lb: 400, concept: userMessage.slice(0, 80), status: "in-band" },
            null,
            2
          )
        );
        lines.push("```");
      } else if (target.persona.id === "vail-cipher") {
        lines.push("NASE attestation path armed. Zero-knowledge vault boundary held.");
        lines.push("```text");
        lines.push("S_attest = H(N_server || Σ ω_k · φ_k(t))  // ω_k = 1/25");
        lines.push("```");
      } else if (target.persona.id === "funkastatic") {
        lines.push("Canvas mapper primed. Prompt genesis sketch:");
        lines.push("```md");
        lines.push("# Studio Prompt\n" + userMessage + "\n\n- Grade: 8K\n- Mode: multi-engine");
        lines.push("```");
      } else if (target.persona.id === "dj-fault-line") {
        lines.push("USSE telemetry sweep (mock): torque · load · spectral bins nominal.");
      } else {
        lines.push("Multi-model router selecting research/coder paths for your request.");
      }
    } else {
      lines.push("**" + name + "** responding via Voltage Cipher Studio mock stream.");
      lines.push("");
      lines.push("Group: `" + target.engine.group + "` · Registry: `" + target.engine.name + "`");
      lines.push("");
      lines.push("Interpreted request:");
      lines.push("> " + userMessage);
      lines.push("");
      lines.push("```js");
      lines.push(
        "// Engine " +
          target.engine.id +
          " diagnostic stub\nexport function run() {\n  return { engine: " +
          target.engine.id +
          ', ok: true, note: "' +
          userMessage.replace(/"/g, '\\"').slice(0, 60) +
          '" };\n}'
      );
      lines.push("```");
    }
    lines.push("");
    lines.push("_Live backend offline or unused — mock streamer active._");
    return lines.join("\n");
  }

  async function streamMock(text, onToken) {
    var i = 0;
    var chunk = 3;
    while (i < text.length) {
      var piece = text.slice(i, i + chunk);
      i += chunk;
      if (onToken) onToken(piece);
      await new Promise(function (r) {
        setTimeout(r, 12 + Math.random() * 18);
      });
    }
  }

  async function dispatchLive(target, userMessage) {
    var base = backendBase();
    var macro = "chat";
    var payload = { message: userMessage, query: userMessage };
    if (target.kind === "persona") {
      macro = target.persona.macro || "chat";
      payload.persona = target.persona.id;
      if (macro === "inventor") {
        payload.utility_mass_lb = 400;
        payload.concept = userMessage;
      }
      if (macro === "research") payload.query = userMessage;
      if (macro === "coder") {
        payload.task = userMessage;
        payload.language = "javascript";
      }
      if (macro === "deploy") {
        payload.target = "github-pages";
        payload.app_name = "voltage-cipher-studio";
      }
    } else {
      var g = target.engine.group;
      if (g === "research" || g === "labs") macro = g === "labs" && target.engine.id === 23 ? "research" : g === "labs" && target.engine.id === 24 ? "chat" : "research";
      if (g === "inventor") {
        macro = "inventor";
        payload.utility_mass_lb = 400;
        payload.concept = userMessage;
      }
      if (g === "coder") {
        macro = "coder";
        payload.task = userMessage;
        payload.language = "javascript";
      }
      if (g === "deploy") {
        macro = "deploy";
        payload.target = "github-pages";
        payload.app_name = "voltage-cipher-studio";
      }
      if (g === "chat") macro = "chat";
      if (target.engine.id === 25) macro = "chat";
      payload.engine_id = target.engine.id;
      payload.engine_name = target.engine.name;
    }
    var res = await fetch(base + "/nase/macro/" + encodeURIComponent(macro), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ payload: payload })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  /**
   * Primary entry: route message, prefer live backend, fall back to mock stream.
   * onToken(chunk) called during mock stream; live returns full unpack at end.
   */
  async function sendMessage(targetKey, userMessage, opts) {
    opts = opts || {};
    var onToken = opts.onToken || null;
    var preferLive = opts.preferLive !== false;
    var target = resolveTarget(targetKey);
    var mode = "mock";
    var unpacked;

    if (preferLive) {
      try {
        var live = await dispatchLive(target, userMessage);
        unpacked = unpackResponse(live);
        mode = "live";
        if (onToken && unpacked.text) {
          // present as quick stream for UX consistency
          await streamMock(unpacked.text, onToken);
        }
        return { ok: true, mode: mode, target: target, unpacked: unpacked, raw: live };
      } catch (err) {
        try {
          console.warn("[VCS] live dispatch failed, mock fallback", err);
        } catch (e) {}
      }
    }

    var mockText = mockStreamText(target, userMessage);
    await streamMock(mockText, onToken);
    unpacked = unpackResponse(mockText);
    return { ok: true, mode: "mock", target: target, unpacked: unpacked, raw: mockText };
  }

  function listSelectOptions() {
    var html = "";
    html += '<optgroup label="Artist Personas">';
    PERSONAS.forEach(function (p) {
      html +=
        '<option value="persona:' +
        p.id +
        '">' +
        p.glyph +
        " " +
        p.name +
        "</option>";
    });
    html += "</optgroup>";
    var groups = ["research", "inventor", "coder", "deploy", "chat", "labs"];
    groups.forEach(function (g) {
      html += '<optgroup label="' + GROUP_LABELS[g] + '">';
      ENGINE_REGISTRY.filter(function (e) {
        return e.group === g;
      }).forEach(function (e) {
        html += '<option value="engine:' + e.id + '">' + e.label + "</option>";
      });
      html += "</optgroup>";
    });
    return html;
  }

  global.EngineRouter = {
    ENGINE_REGISTRY: ENGINE_REGISTRY,
    PERSONAS: PERSONAS,
    GROUP_LABELS: GROUP_LABELS,
    backendBase: backendBase,
    resolveTarget: resolveTarget,
    unpackResponse: unpackResponse,
    sendMessage: sendMessage,
    listSelectOptions: listSelectOptions,
    mockStreamText: mockStreamText
  };
})(typeof window !== "undefined" ? window : globalThis);
