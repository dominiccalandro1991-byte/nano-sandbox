(function (global) {
  "use strict";
  var ARTISTS = [
    { id: "vail-cipher", glyph: "🔐", name: "Vail Cipher", lane: "Encrypted synth-pop / glitch-R&B" },
    { id: "backroad-voltage", glyph: "⚡", name: "BackRoad Voltage", lane: "Southern voltage country-rock" },
    { id: "funkastatic", glyph: "🎨", name: "Funkastatic", lane: "Color-soaked funk / nu-disco" },
    { id: "aisle-nine", glyph: "⚙️", name: "Aisle Nine", lane: "Industrial-pop / fluorescent noir" },
    { id: "dj-fault-line", glyph: "📡", name: "DJ Fault Line", lane: "Seismic bass / club aftershock" }
  ];
  var MODEL = "google/gemma-4-26b-a4b-it:free";
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
    var history = thread().filter(function (m) { return m.role === "user" || m.role === "assistant"; }).slice(-12);
    fetch(remote() + "/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: history,
        persona: current.id,
        suno: true,
        max_tokens: 4096
      })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        var body = x.j.detail || x.j;
        var reply = (body && (body.content || body.result)) || (typeof body === "string" ? body : "") || "I couldn't reach the booth. Try again.";
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
