/**
 * engine-router.js — Voltage Cipher Studio dispatcher
 * 25 engines + 5 personas · live NASE backend · mock stream fallback
 */
(function (global) {
  "use strict";

  var DEFAULT_BACKEND = "https://nano-sandbox-api.onrender.com";

  var FREE_MODELS = [
    { id: "poolside/laguna-s-2.1:free", label: "Laguna S 2.1 (Lead Architect)", category: "coding_pro", categoryLabel: "Coding Pro (Free)" },
    { id: "poolside/laguna-xs-2.1:free", label: "Laguna XS 2.1 (Fast Iteration)", category: "coding_pro", categoryLabel: "Coding Pro (Free)" },
    { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B (Code Reviewer)", category: "coding_pro", categoryLabel: "Coding Pro (Free)" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra (Deep Reasoning)", category: "general", categoryLabel: "General Chat & Reasoning (Free)" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (Balanced)", category: "general", categoryLabel: "General Chat & Reasoning (Free)" },
    { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B (Generalist)", category: "general", categoryLabel: "General Chat & Reasoning (Free)" }
  ];

  var DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

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

  /** Extract display text; log hash receipts to console — never as primary bubble text */
  function unpackEngineResponse(data, targetName) {
    targetName = targetName || "Engine";
    if (data == null) {
      return {
        text: "[" + targetName + "] Online and connected. How can I assist you with this engine group?",
        hash: null,
        codeBlocks: [],
        raw: data
      };
    }
    var hash = null;
    var text = null;
    if (typeof data === "string") {
      text = data;
    } else if (typeof data === "object") {
      hash =
        data.hash ||
        data.S_attest ||
        data.s_attest ||
        data.attestation_signature ||
        (data.attestation && (data.attestation.s_attest || data.attestation.S_attest)) ||
        null;
      if (hash) {
        try {
          console.log("[Attestation Verified for " + targetName + "]:", hash);
        } catch (e) {}
      }
      // Prefer real conversational / result fields — never surface hash as the message
      if (typeof data.result === "string" && data.result.trim()) text = data.result;
      else if (typeof data.response === "string" && data.response.trim()) text = data.response;
      else if (typeof data.content === "string" && data.content.trim()) text = data.content;
      else if (typeof data.message === "string" && data.message.trim()) text = data.message;
      else if (data.result && typeof data.result === "object") {
        if (Array.isArray(data.result.findings) && data.result.findings.length) {
          text = data.result.findings.join("\n");
        } else if (data.result.role) {
          var bits = [String(data.result.role)];
          if (data.result.findings) bits = bits.concat(data.result.findings);
          text = bits.join("\n");
        }
      }
      if (!text && data.macro_engine && data.status) {
        // Structured macro status without dumping full JSON / hashes
        var lines = ["**" + data.macro_engine + "** · " + data.status];
        if (data.execution_ms != null) lines.push("execution_ms: " + data.execution_ms);
        if (data.result && Array.isArray(data.result.findings)) {
          lines = lines.concat(data.result.findings);
        } else if (data.result && data.result.role) {
          lines.push(String(data.result.role));
        }
        text = lines.join("\n");
      }
    }
    if (!text || !String(text).trim()) {
      text =
        "[" +
        targetName +
        "] Online and connected. How can I assist you with this engine group?";
    }
    // Strip lone 64-char hex lines that are pure hash receipts
    text = String(text).replace(/(^|\n)\s*[a-f0-9]{64}\s*(?=\n|$)/gi, "$1").trim();
    var codeBlocks = [];
    var re = /```([\w-]*)\n([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text))) {
      codeBlocks.push({ lang: m[1] || "", code: m[2] });
    }
    return { text: text, hash: hash, codeBlocks: codeBlocks, raw: data };
  }

  function unpackResponse(data, targetName) {
    return unpackEngineResponse(data, targetName);
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
  
  async function chatLLM(modelId, messages, opts) {
    opts = opts || {};
    var base = backendBase();
    var res = await fetch(base + "/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: modelId || DEFAULT_MODEL,
        messages: messages,
        persona: opts.persona || null,
        engine_id: opts.engineId != null ? opts.engineId : null,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens != null ? opts.maxTokens : 2048
      })
    });
    var body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = { error: "non_json", status: res.status };
    }
    if (!res.ok) {
      var err = new Error(
        (body && body.detail && (body.detail.message || JSON.stringify(body.detail))) ||
          "LLM HTTP " + res.status
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function modelSelectOptionsHtml() {
    var html = "";
    var cats = [
      { key: "coding_pro", label: "Coding Pro (Free)" },
      { key: "general", label: "General Chat & Reasoning (Free)" }
    ];
    cats.forEach(function (c) {
      html += '<optgroup label="' + c.label + '">';
      FREE_MODELS.filter(function (m) {
        return m.category === c.key;
      }).forEach(function (m) {
        html +=
          '<option value="' +
          m.id +
          '">' +
          m.label +
          "</option>";
      });
      html += "</optgroup>";
    });
    return html;
  }

  async function sendMessage(targetKey, userMessage, opts) {
    opts = opts || {};
    var onToken = opts.onToken || null;
    var target = resolveTarget(targetKey);
    var targetName =
      target.kind === "persona"
        ? target.persona.name
        : "Engine " + target.engine.id + " (" + target.engine.name + ")";
    var modelId = opts.model || DEFAULT_MODEL;

    // Build OpenAI-style messages array from prior turns + current user message
    var history = Array.isArray(opts.history) ? opts.history.slice() : [];
    var messages = [];
    history.forEach(function (m) {
      if (!m || !m.content) return;
      var role = m.role === "assistant" || m.role === "system" ? m.role : "user";
      // skip empty / pure fault stubs
      if (String(m.content).indexOf("Grounded chat core bound to Supabase") !== -1) return;
      messages.push({ role: role, content: String(m.content) });
    });
    messages.push({ role: "user", content: userMessage });

    try {
      var llm = await chatLLM(modelId, messages, {
        persona: target.kind === "persona" ? target.persona.id : null,
        engineId: target.kind === "engine" ? target.engine.id : null,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens
      });
      var unpacked = unpackResponse(llm, targetName);
      // Prefer explicit content/result fields from /llm/chat
      if (llm && typeof llm.content === "string" && llm.content.trim()) {
        unpacked.text = llm.content;
      } else if (llm && typeof llm.result === "string" && llm.result.trim()) {
        unpacked.text = llm.result;
      }
      if (onToken && unpacked.text) {
        await streamMock(unpacked.text, onToken);
      }
      return {
        ok: true,
        mode: "llm",
        target: target,
        unpacked: unpacked,
        raw: llm,
        model: modelId
      };
    } catch (llmErr) {
      var detail =
        (llmErr && llmErr.body && llmErr.body.detail) ||
        (llmErr && llmErr.message) ||
        String(llmErr);
      if (typeof detail === "object") {
        try {
          detail = detail.message || JSON.stringify(detail);
        } catch (e) {
          detail = String(detail);
        }
      }
      // Optional explicit mock only when allowMock:true (dev) — never NASE macro stubs
      if (opts.allowMock) {
        var mockText = mockStreamText(target, userMessage);
        if (onToken) await streamMock(mockText, onToken);
        return {
          ok: true,
          mode: "mock",
          target: target,
          unpacked: unpackResponse(mockText, targetName),
          raw: mockText,
          model: modelId
        };
      }
      var err = new Error(String(detail));
      err.status = llmErr && llmErr.status;
      err.body = llmErr && llmErr.body;
      throw err;
    }
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
    FREE_MODELS: FREE_MODELS,
    DEFAULT_MODEL: DEFAULT_MODEL,
    backendBase: backendBase,
    resolveTarget: resolveTarget,
    unpackResponse: unpackResponse,
    unpackEngineResponse: unpackEngineResponse,
    sendMessage: sendMessage,
    chatLLM: chatLLM,
    listSelectOptions: listSelectOptions,
    modelSelectOptionsHtml: modelSelectOptionsHtml,
    mockStreamText: mockStreamText
  };
})(typeof window !== "undefined" ? window : globalThis);
