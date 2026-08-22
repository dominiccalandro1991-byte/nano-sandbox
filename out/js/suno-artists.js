(function (global) {
  "use strict";
  var ARTISTS = [
    { id: "vail-cipher", glyph: "🔐", name: "Vail Cipher", lane: "Encrypted synth-pop / glitch-R&B" },
    { id: "backroad-voltage", glyph: "⚡", name: "BackRoad Voltage", lane: "Southern voltage country-rock" },
    { id: "funkastatic", glyph: "🎨", name: "Funkastatic", lane: "Color-soaked funk / nu-disco" },
    { id: "aisle-nine", glyph: "⚙️", name: "Aisle Nine", lane: "Industrial-pop / fluorescent noir" },
    { id: "dj-fault-line", glyph: "📡", name: "DJ Fault Line", lane: "Seismic bass / club aftershock" }
  ];
  var MODEL = "poolside/laguna-xs-2.1:free";
  var FALLBACKS = [
    "poolside/laguna-xs-2.1:free",
    "poolside/laguna-s-2.1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-26b-a4b-it:free"
  ];
  var current = ARTISTS[0];
  var threads = {};

  function $(id) { return document.getElementById(id); }
  function remote() {
    try {
      if (global.__NNACC_REMOTE__) return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      var s = localStorage.getItem("nnacc-v2-remote") || "";
      if (s) return s.replace(/\/$/, "");
    } catch (e) {}
    return "https://nano-sandbox-api.onrender.com";
  }
  function thread() {
    if (!threads[current.id]) threads[current.id] = [];
    return threads[current.id];
  }
  function clip(s, n) {
    s = String(s || "");
    return s.length <= n ? s : s.slice(0, n);
  }
  function parseSheet(text) {
    var raw = String(text || "").replace(/\r/g, "");
    var keys = ["CONCEPT", "TITLE", "STYLE", "LYRICS"];
    var found = {};
    var hits = 0;
    keys.forEach(function (k) {
      var re = new RegExp("(?:^|\\n)\\s*" + k + "\\s*\\n", "i");
      if (re.test(raw)) hits++;
    });
    if (hits < 2) return null;
    var idx = keys.map(function (k) {
      var re = new RegExp("(?:^|\\n)\\s*" + k + "\\s*\\n", "i");
      var m = re.exec(raw);
      return m ? { k: k, at: m.index, len: m[0].length } : null;
    }).filter(Boolean).sort(function (a, b) { return a.at - b.at; });
    for (var i = 0; i < idx.length; i++) {
      var start = idx[i].at + idx[i].len;
      var end = i + 1 < idx.length ? idx[i + 1].at : raw.length;
      found[idx[i].k] = raw.slice(start, end).trim();
    }
    if (found.STYLE) found.STYLE = clip(found.STYLE, 1000);
    if (found.LYRICS) found.LYRICS = clip(found.LYRICS, 5000);
    return found;
  }
  function addMsg(role, text, extra) {
    var log = $("artists-log");
    if (!log) return;
    var el = document.createElement("div");
    el.className = "msg " + role;
    var meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = role === "user" ? "You" : current.name;
    el.appendChild(meta);
    var body = document.createElement("div");
    body.className = "msg-body";
    var sheet = role === "assistant" ? parseSheet(text) : null;
    if (sheet) {
      var intro = document.createElement("div");
      intro.textContent = sheet.CONCEPT ? "" : "";
      var wrap = document.createElement("div");
      wrap.className = "suno-sheet";
      if (sheet.CONCEPT) {
        var p = document.createElement("p");
        p.textContent = sheet.CONCEPT;
        wrap.appendChild(p);
      }
      ["TITLE", "STYLE", "LYRICS"].forEach(function (k) {
        if (!sheet[k]) return;
        var blk = document.createElement("div");
        blk.className = "suno-block" + (k === "LYRICS" ? " lyrics" : "");
        var hd = document.createElement("header");
        hd.innerHTML = "<span>" + k + "</span>";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "suno-copy";
        btn.textContent = "Copy";
        btn.addEventListener("click", function () {
          try { navigator.clipboard.writeText(sheet[k]); btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1200); } catch (e) {}
        });
        hd.appendChild(btn);
        var pre = document.createElement("pre");
        pre.textContent = sheet[k];
        blk.appendChild(hd);
        blk.appendChild(pre);
        if (k === "STYLE") {
          var m = document.createElement("div");
          m.className = "suno-meta";
          m.textContent = sheet[k].length + " / 1000 characters";
          blk.appendChild(m);
        }
        if (k === "LYRICS") {
          var m2 = document.createElement("div");
          m2.className = "suno-meta";
          m2.textContent = sheet[k].length + " / 5000 characters";
          blk.appendChild(m2);
        }
        wrap.appendChild(blk);
      });
      body.appendChild(wrap);
    } else {
      body.textContent = text;
    }
    el.appendChild(body);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
  function renderPicker() {
    var grid = $("artists-grid");
    if (!grid) return;
    grid.innerHTML = "";
    ARTISTS.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "artist-card";
      b.innerHTML = '<span class="ag">' + a.glyph + '</span><span class="an">' + a.name + '</span><span class="al">' + a.lane + "</span>";
      b.addEventListener("click", function () { openArtist(a); });
      grid.appendChild(b);
    });
  }
  function openArtist(a) {
    current = a;
    $("artists-picker").hidden = true;
    $("artists-chat").hidden = false;
    $("artists-name").textContent = a.glyph + " " + a.name;
    $("artists-lane").textContent = a.lane + " · Suno sheet when you ask for a song";
    var log = $("artists-log");
    log.innerHTML = "";
    if (!thread().length) {
      thread().push({
        role: "assistant",
        content: "Hey — I'm " + a.name + ". Talk to me like a person, or ask for a full Suno track and I'll hand you concept, title, style, and lyrics."
      });
    }
    thread().forEach(function (m) { addMsg(m.role, m.content); });
    var input = $("artists-input");
    if (input) input.focus();
  }
  function send(ev) {
    if (ev) ev.preventDefault();
    var input = $("artists-input");
    var text = (input && input.value || "").trim();
    if (!text) return;
    input.value = "";
    thread().push({ role: "user", content: text });
    addMsg("user", text);
    var btn = $("artists-send");
    if (btn) btn.disabled = true;
    var apiUser = text;
    if (/full song|full track|write (a |the )?song|suno|lyrics|the song/i.test(text) && text.length < 120) {
      apiUser = text + " Invent a complete in-character concept. Output CONCEPT then TITLE then STYLE then LYRICS now. No questions. No planning.";
    }
    var history = thread().filter(function (m) {
      if (m.role === "user") return true;
      if (m.role !== "assistant") return false;
      return String(m.content || "").indexOf("Hey — I'm ") !== 0;
    }).slice(-10);
    if (history.length && history[history.length - 1].role === "user") {
      history = history.slice(0, -1).concat([{ role: "user", content: apiUser }]);
    }

    function extract(x) {
      var j = x.j || {};
      if (j.content) return { text: j.content, ok: true };
      if (j.result) return { text: j.result, ok: true };
      var d = j.detail;
      if (typeof d === "string") return { text: d, ok: false };
      var msg = d && d.detail && d.detail.error && d.detail.error.message;
      if (x.ok === false && (d && d.status === 429 || /429/.test(String(msg || "")))) {
        return { text: "", ok: false, busy: true };
      }
      if (msg) return { text: msg, ok: false, busy: /rate-limited|429|unavailable/i.test(msg) };
      return { text: "", ok: false };
    }

    function tryModel(i) {
      var mid = FALLBACKS[i] || MODEL;
      return fetch(remote() + "/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: mid,
          messages: history,
          persona: current.id,
          suno: true,
          max_tokens: 2500
        })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          var got = extract(x);
          if (got.ok && got.text) return got.text;
          if (got.busy && i + 1 < FALLBACKS.length) return tryModel(i + 1);
          if (got.text) return got.text;
          if (i + 1 < FALLBACKS.length) return tryModel(i + 1);
          return "The free models are busy right now. Send that again in a few seconds.";
        });
    }

    tryModel(0)
      .then(function (reply) {
        thread().push({ role: "assistant", content: reply });
        addMsg("assistant", reply);
      })
      .catch(function (err) {
        addMsg("assistant", "Booth unreachable: " + (err && err.message ? err.message : err));
      })
      .then(function () { if (btn) btn.disabled = false; });
  }
  function wire() {
    renderPicker();
    var form = $("artists-form");
    var back = $("artists-back");
    if (form) form.addEventListener("submit", send);
    if (back) back.addEventListener("click", function () {
      $("artists-chat").hidden = true;
      $("artists-picker").hidden = false;
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})(typeof window !== "undefined" ? window : globalThis);
