/**
 * studio-engine.js — Creative Canvas Genesis & Studio Prompt Suite
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine battery (1–25) : evaluateConcept() performs a client-side multi-engine
 *                         validation pass and surfaces structural / economic /
 *                         operational flags. This is a heuristic simulation of
 *                         the registered validators; live execution still routes
 *                         through the remote backend when configured.
 * Engine 25 (NNACC)     : chat surface can hand concepts into the Studio.
 * NASE Δt + I5          : all mutations remain gated by ui-controller.js.
 *
 * Pure client-side. Deterministic. No privilege escalation paths.
 * Evidence class: Partially Verified (mirrors registered engine concerns without
 * claiming live backend attestation or real physics solvers).
 */

(function (global) {
  "use strict";

  function evaluateConcept(rawText, filename) {
    const text = (rawText || "").trim();
    const name = filename || "pasted-concept";
    const lower = text.toLowerCase();
    const flags = [];
    const enginesHit = [];

    if (text.length < 20) {
      flags.push({
        severity: "high",
        engine: "nnacc-chat",
        code: "INSUFFICIENT_SIGNAL",
        message: "Concept too short for meaningful multi-engine analysis.",
      });
      return { ok: false, flags, enginesHit, summary: "Rejected — insufficient signal." };
    }

    if (/\b(physics|rigid\s*body|soft\s*body|collision|gravity|torque|stress|strain|mass|force)\b/i.test(text)) {
      enginesHit.push("soft-body-physics", "geometry-tolerance");
      if (!/\b(mass|kg|lb|force|n|newton)\b/i.test(text)) {
        flags.push({
          severity: "medium",
          engine: "soft-body-physics",
          code: "MISSING_PHYSICAL_UNITS",
          message: "Physical language detected but no mass/force units supplied. Stress results will be under-constrained.",
        });
      }
    }

    if (/\b(thermal|heat|temperature|cooling|dissipation|thermal\s*path)\b/i.test(text)) {
      enginesHit.push("thermal-dissipation");
      if (!/\b(w|watt|°c|celsius|kelvin|k)\b/i.test(text)) {
        flags.push({
          severity: "low",
          engine: "thermal-dissipation",
          code: "MISSING_THERMAL_UNITS",
          message: "Thermal language present without power or temperature units.",
        });
      }
    }

    if (/\b(agent|npc|entity|swarm|multi-?agent|tick\s*rate|simulation)\b/i.test(text)) {
      enginesHit.push("multi-agent-interaction", "usse-stress");
      const agentMatch = text.match(/(\d+)\s*(?:agents?|entities|npcs?)/i);
      if (agentMatch && parseInt(agentMatch[1], 10) > 500) {
        flags.push({
          severity: "medium",
          engine: "usse-stress",
          code: "HIGH_AGENT_COUNT",
          message: `Agent count ${agentMatch[1]} exceeds typical single-node comfort zone; expect elevated digital load pressure.`,
        });
      }
    }

    if (/\b(budget|cost|revenue|roi|monetiz|pricing|subscription)\b/i.test(text)) {
      enginesHit.push("causal-fusion");
      flags.push({
        severity: "info",
        engine: "causal-fusion",
        code: "ECONOMIC_SIGNAL",
        message: "Economic language detected. Causal-fusion can model revenue vs. operational cost once numeric baselines are supplied.",
      });
    }

    if (/\b(ip|patent|copyright|seal|vault|proprietary|trade\s*secret)\b/i.test(text)) {
      enginesHit.push("oiav-vault");
    }

    if (/\b(attestation|nase|gateway|privilege|escalat|policy)\b/i.test(text)) {
      enginesHit.push("nase-aegis");
    }

    const isAudioVisual =
      /\b(song|lyrics|bpm|tempo|melody|chord|verse|chorus|track|album|music|key\s*visual|music\s*video|cinematic|8k|photoreal)\b/i.test(text) ||
      /\.(mp3|wav|flac|aiff)$/i.test(name);

    if (isAudioVisual) {
      enginesHit.push("nnacc-chat");
    }

    if (text.length > 1200 && flags.filter((f) => f.severity === "high").length === 0) {
      enginesHit.push("rte-repair-plan");
    }

    const uniqueEngines = [...new Set(enginesHit)];
    const highCount = flags.filter((f) => f.severity === "high").length;
    const ok = highCount === 0;

    return {
      ok,
      flags,
      enginesHit: uniqueEngines,
      isAudioVisual,
      summary: ok
        ? `Validated across ${uniqueEngines.length || 1} engine proxies. ${flags.length} advisory flag(s).`
        : `Blocked by ${highCount} high-severity flag(s).`,
      source: name,
      length: text.length,
      timestamp: new Date().toISOString(),
    };
  }

  function generateCanvasMap(conceptText, validation) {
    const seed = hashString(conceptText.slice(0, 200) + (validation.source || ""));
    const rng = mulberry32(seed);

    const viewport = {
      width: 1920 + Math.floor(rng() * 640),
      height: 1080 + Math.floor(rng() * 360),
      aspect: null,
      fov: 45 + Math.floor(rng() * 30),
      near: 0.1,
      far: 2000 + Math.floor(rng() * 3000),
      antialias: true,
      powerPreference: "high-performance",
    };
    viewport.aspect = +(viewport.width / viewport.height).toFixed(4);

    const camera = {
      type: rng() > 0.5 ? "PerspectiveCamera" : "OrthographicCamera",
      position: [
        +(rng() * 40 - 20).toFixed(2),
        +(8 + rng() * 25).toFixed(2),
        +(rng() * 40 - 20).toFixed(2),
      ],
      lookAt: [0, 2 + rng() * 4, 0],
      orbitControls: true,
      damping: 0.08 + rng() * 0.1,
    };

    const shaders = {
      primary: {
        name: validation.isAudioVisual ? "volumetric-rim-haze" : "metric-reactive-pbr",
        uniforms: {
          uTime: { type: "f", value: 0 },
          uIntensity: { type: "f", value: +(0.4 + rng() * 0.6).toFixed(3) },
          uRimColor: { type: "c", value: validation.isAudioVisual ? "#c8e0ff" : "#3d8bfd" },
          uHazeDensity: { type: "f", value: +(0.015 + rng() * 0.04).toFixed(4) },
        },
        fragmentNotes:
          "Custom GLSL: Fresnel rim + Rayleigh-style height fog. Bound to engine metric triggers.",
      },
      secondary: {
        name: "entity-glow-pulse",
        bindTo: "engine.metric.pressure",
        pulseHz: +(0.3 + rng() * 1.2).toFixed(2),
      },
    };

    const entityRules = {
      maxEntities: validation.enginesHit.includes("usse-stress") ? 128 + Math.floor(rng() * 256) : 32 + Math.floor(rng() * 64),
      placement: {
        strategy: rng() > 0.6 ? "poisson-disk" : "grid-jitter",
        radius: +(1.2 + rng() * 3.5).toFixed(2),
        yRange: [0, +(3 + rng() * 8).toFixed(1)],
      },
      lod: {
        enabled: true,
        distances: [25, 60, 120],
      },
      bindMetrics: [
        { engine: "soft-body-physics", metric: "strain", visual: "vertex-displacement" },
        { engine: "usse-stress", metric: "load_pressure", visual: "emissive-intensity" },
        { engine: "thermal-dissipation", metric: "heat_flux", visual: "color-ramp" },
      ],
    };

    const uiGrid = {
      columns: 12,
      gutter: 16,
      margin: 24,
      panels: [
        { id: "viewport", col: "1 / 9", row: "1 / 3", bind: "canvas" },
        { id: "engine-telemetry", col: "9 / 13", row: "1 / 2", bind: "validation.enginesHit" },
        { id: "flag-list", col: "9 / 13", row: "2 / 3", bind: "validation.flags" },
        { id: "prompt-export", col: "1 / 13", row: "3 / 4", bind: "studioPrompt" },
      ],
      reactiveStates: {
        "attestation.stale": { opacity: 0.45, filter: "grayscale(0.6)" },
        "engine.high-severity": { borderColor: "var(--danger)", pulse: true },
        "engine.ok": { borderColor: "var(--success)" },
      },
    };

    return {
      generatedAt: new Date().toISOString(),
      seed,
      source: validation.source,
      enginesConsulted: validation.enginesHit,
      viewport,
      camera,
      shaders,
      entityRules,
      uiGrid,
      threeJsNotes:
        "Instantiate THREE.WebGLRenderer with the viewport specs. Attach OrbitControls. " +
        "Register uniform updaters that pull from live engine metric streams when a remote is present.",
    };
  }

  function generateStudioPrompt(conceptText, validation) {
    const lower = (conceptText || "").toLowerCase();
    const isMusic =
      validation.isAudioVisual ||
      /\b(song|lyrics|bpm|tempo|melody|chorus|verse|album|track|music)\b/i.test(lower);

    let subjectCore = conceptText.slice(0, 280).replace(/\s+/g, " ").trim();
    if (subjectCore.length > 240) subjectCore = subjectCore.slice(0, 237) + "…";

    let mood = "cinematic, intense focus";
    if (/\b(dark|noir|night|shadow)\b/i.test(lower)) mood = "low-key noir, deep shadows";
    else if (/\b(bright|day|sun|golden)\b/i.test(lower)) mood = "golden-hour warmth, luminous";
    else if (/\b(ethereal|dream|soft|haze)\b/i.test(lower)) mood = "ethereal, soft volumetric haze";
    else if (/\b(aggressive|power|metal|industrial)\b/i.test(lower)) mood = "industrial power, hard specular highlights";

    const camera = isMusic
      ? "Hasselblad H6D-100c medium-format sensor, 85mm f/1.2 prime lens, shallow depth of field, subject isolation"
      : "ARRI ALEXA 35, 50mm T1.4 Master Prime, cinematic anamorphic subtlety, controlled bokeh";

    const lighting =
      "Volumetric studio key light at 5600K daylight balance, softbox + large diffusion, " +
      "strong cinematic rim glow from rear three-quarter, subtle Rayleigh haze in the air volume, " +
      "controlled negative fill, no harsh specular blow-outs";

    const quality =
      "8K UHD resolution, photorealistic micro-textures, zero artifacts, filmic color grading, " +
      "high dynamic range, subtle film grain, production-ready key visual";

    const composition = isMusic
      ? "Low-angle hero composition, clean negative space for typography, device or instrument in sharp focus, " +
        "background elements softly dissolved, vertical or landscape orientation optimized for music key visual"
      : "Balanced architectural or product framing, clear hierarchy of form, technical accuracy, " +
        "readable material response under studio lighting";

    const prompt = [
      `Ultra-photorealistic studio key visual of: ${subjectCore}.`,
      `Mood: ${mood}.`,
      `Camera & Optics: ${camera}.`,
      `Lighting & Atmosphere: ${lighting}.`,
      `Composition: ${composition}.`,
      `Production Quality: ${quality}.`,
      `Technical notes: absolute realism, no illustration style, no CGI look, pure photographic capture aesthetic.`,
    ].join(" ");

    return {
      prompt,
      meta: {
        isMusicKeyVisual: isMusic,
        camera,
        lightingSummary: "5600K volumetric key + rim + Rayleigh haze",
        targetResolution: "8K UHD",
        generatedAt: new Date().toISOString(),
        enginesTouched: validation.enginesHit,
      },
    };
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  global.StudioEngine = {
    evaluateConcept,
    generateCanvasMap,
    generateStudioPrompt,
  };
})(typeof window !== "undefined" ? window : globalThis);
