/**
 * usse-bridge.js — Engine 23 (USSE) ingestion & payload builder
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine 23 (USSE) : parseSpec / buildFromText / looksLikeSpec
 *                    → produces payloads accepted by backend/app/usse/stress.py
 *                      and the registered USSEValidator
 * NASE             : caller (ui-controller) must enforce Δt before dispatch
 * Engine 25 (NNACC): chat surface calls these helpers when a file is dropped
 *                    or when the user says “run USSE …”
 *
 * Pure client-side. No network. No privilege escalation paths.
 */

(function (global) {
  "use strict";

  /**
   * Heuristic: does this text look like a game / physics / logic specification
   * that USSE should be offered for?
   */
  function looksLikeSpec(text, filename) {
    if (!text || text.length < 40) return false;
    const name = (filename || "").toLowerCase();
    if (/\.(md|txt)$/i.test(name)) {
      /* filename hint is positive but not sufficient */
    }
    const signals = [
      /\b(physics|rigid\s*body|soft\s*body|collision|gravity|torque|lever|load|mass|force|stress|strain)\b/i,
      /\b(entity|tick\s*rate|simulation|game\s*loop|world\s*step)\b/i,
      /\b(galactic|domination|planet\s*builder|spaceship|thruster)\b/i,
      /\b(yield\s*stress|section\s*modulus|bending|moment)\b/i,
      /\b(agent_count|requests_per_second|p99|latency)\b/i,
    ];
    let hits = 0;
    for (const re of signals) {
      if (re.test(text)) hits += 1;
    }
    return hits >= 2;
  }

  /**
   * Extract numeric parameters from free-form markdown / text.
   * Returns a payload shaped for backend compute_physical_stress + compute_digital_load.
   */
  function parseSpec(text, filename) {
    const payload = {
      source: filename || "pasted-spec",
      force_n: 0,
      lever_arm_m: 0.5,
      theta_deg: 90,
      mass_kg: 0,
      load_lb: 0,
      duration_h: 1,
      power_w: 0,
      section_modulus_m3: 1e-5,
      yield_stress_pa: 2.5e8,
      agent_count: 0,
      requests_per_second: 0,
      p99_latency_ms: 0,
      error_rate: 0,
      notes: [],
    };

    // load_lb / mass
    const lb = text.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)/i);
    if (lb) {
      payload.load_lb = parseFloat(lb[1]);
      payload.mass_kg = payload.load_lb * 0.45359237;
      payload.notes.push(`Detected load_lb=${payload.load_lb}`);
    }
    const kg = text.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (kg && !payload.mass_kg) {
      payload.mass_kg = parseFloat(kg[1]);
      payload.notes.push(`Detected mass_kg=${payload.mass_kg}`);
    }

    // force
    const force = text.match(/(\d+(?:\.\d+)?)\s*(?:N|newtons?)/i);
    if (force) {
      payload.force_n = parseFloat(force[1]);
      payload.notes.push(`Detected force_n=${payload.force_n}`);
    }

    // lever arm
    const arm = text.match(/(?:lever|arm|moment\s*arm)[^\d]{0,20}(\d+(?:\.\d+)?)\s*m/i);
    if (arm) {
      payload.lever_arm_m = parseFloat(arm[1]);
      payload.notes.push(`Detected lever_arm_m=${payload.lever_arm_m}`);
    }

    // agents / digital load
    const agents = text.match(/(\d+)\s*(?:agents?|entities|npcs?)/i);
    if (agents) {
      payload.agent_count = parseInt(agents[1], 10);
      payload.notes.push(`Detected agent_count=${payload.agent_count}`);
    }

    // duration
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hours?|hrs?)/i);
    if (hours) {
      payload.duration_h = parseFloat(hours[1]);
      payload.notes.push(`Detected duration_h=${payload.duration_h}`);
    }

    // Fallback defaults for game-style specs that only mention “400 lb class”
    if (!payload.load_lb && !payload.mass_kg && !payload.force_n) {
      if (/\b(400|450|500)\s*lb/i.test(text) || /heavy\s*load/i.test(text)) {
        payload.load_lb = 400;
        payload.mass_kg = 400 * 0.45359237;
        payload.notes.push("Fallback load_lb=400 from class language");
      }
    }

    payload.notes.push(`Parsed from ${filename || "text"} at ${new Date().toISOString()}`);
    return payload;
  }

  /**
   * Lightweight builder used when the user types a natural-language USSE request
   * instead of dropping a file.
   */
  function buildFromText(userText) {
    return parseSpec(userText, "chat-intent");
  }

  // Public API
  global.USSEBridge = {
    looksLikeSpec,
    parseSpec,
    buildFromText,
  };
})(typeof window !== "undefined" ? window : globalThis);
