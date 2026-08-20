/**
 * Composer bar — ChatGPT/Grok/Claude architecture, next-gen.
 * Left: + (files, photos, recent, skills, connectors)
 * Center: textarea
 * Right: model · mic · send
 * Chips confirm scope before send.
 */
(function (global) {
  "use strict";

  var SKILLS = [
    { id: "usse-stress", label: "USSE Stress", view: "usse" },
    { id: "oiav-vault", label: "OIAV Seal", view: "oiav" },
    { id: "vste", label: "Virtual Stress Tester", view: "vste" },
    { id: "studio", label: "Creative Canvas", view: "studio" },
    { id: "aegis", label: "AEGIS Diagnostic", view: "aegis" },
    { id: "macros", label: "Macro Engines", view: "macros" }
  ];

  var CONNECTORS = [
    { id: "api", label: "FastAPI backend", href: "https://nano-sandbox-api.onrender.com/docs" },
    { id: "vault", label: "File Vault", view: "vault" },
    { id: "registry", label: "Engine Registry", view: "registry" }
  ];

  var chips = [];
  var rec = null;
  var listening = false;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    if (global.showToast) global.showToast(msg);
    else if (window.HistoryRail) console.log(msg);
  }

  function closePlus() {
    var m = $("plus-menu");
    if (m) m.hidden = true;
  }

  function togglePlus() {
    var m = $("plus-menu");
    if (!m) return;
    m.hidden = !m.hidden;
    if (!m.hidden) paintRecent();
  }

  function addChip(chip) {
    chips = chips.filter(function (c) {
      return !(c.kind === chip.kind && c.id === chip.id);
    });
    chips.push(chip);
    renderChips();
  }

  function removeChip(id) {
    chips = chips.filter(function (c) {
      return c.id !== id;
    });
    renderChips();
  }

  function renderChips() {
    var el = $("composer-chips");
    if (!el) return;
    el.hidden = chips.length === 0;
    el.innerHTML = "";
    chips.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "scope-chip";
      b.textContent = c.label + " ×";
      b.addEventListener("click", function () {
        removeChip(c.id);
      });
      el.appendChild(b);
    });
  }

  function paintRecent() {
    var box = $("plus-recent");
    if (!box) return;
    box.innerHTML = "";
    var files = [];
    try {
      var s = global.SessionEngine && global.SessionEngine.loadOrCreateActive();
      files = (s && s.files) || [];
    } catch (e) {}
    if (!files.length) {
      box.innerHTML = '<p class="muted small">No recent files in this thread.</p>';
      return;
    }
    files.slice(-8).reverse().forEach(function (f) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plus-item";
      btn.textContent = "📎 " + (f.name || "file");
      btn.addEventListener("click", function () {
        addChip({ kind: "recent", id: f.id, label: f.name });
        closePlus();
        if (global.openFilePreview) global.openFilePreview(f.id);
      });
      box.appendChild(btn);
    });
  }

  function startMic() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    var btn = $("mic-btn");
    if (!SR) {
      if (btn) btn.title = "Voice not supported in this browser";
      alert("Voice dictation needs Safari or Chrome.");
      return;
    }
    if (listening && rec) {
      rec.stop();
      return;
    }
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onstart = function () {
      listening = true;
      if (btn) btn.classList.add("live");
    };
    rec.onend = function () {
      listening = false;
      if (btn) btn.classList.remove("live");
    };
    rec.onerror = function () {
      listening = false;
      if (btn) btn.classList.remove("live");
    };
    rec.onresult = function (ev) {
      var t = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      var ta = $("composer-input");
      if (ta) {
        ta.value = (ta.value ? ta.value + " " : "") + t.trim();
        ta.dispatchEvent(new Event("input"));
      }
    };
    rec.start();
  }

  function wire() {
    var plus = $("plus-btn");
    if (plus) plus.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePlus();
    });
    document.addEventListener("click", function (e) {
      var m = $("plus-menu");
      if (!m || m.hidden) return;
      if (m.contains(e.target) || (plus && plus.contains(e.target))) return;
      closePlus();
    });
    var fileBtn = document.querySelector('[data-plus="file"]');
    if (fileBtn) fileBtn.addEventListener("click", function () {
      var inp = $("file-picker");
      if (inp) inp.click();
      closePlus();
    });
    var photoBtn = document.querySelector('[data-plus="photo"]');
    if (photoBtn) photoBtn.addEventListener("click", function () {
      var inp = $("photo-picker");
      if (inp) inp.click();
      closePlus();
    });
    var webBtn = document.querySelector('[data-plus="web"]');
    if (webBtn) webBtn.addEventListener("click", function () {
      var m = document.getElementById("mode-search");
      if (m) { m.classList.add("on"); m.setAttribute("aria-pressed","true"); }
      closePlus();
    });
    document.querySelectorAll("[data-skill]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-skill");
        var sk = SKILLS.filter(function (s) { return s.id === id; })[0];
        if (!sk) return;
        addChip({ kind: "skill", id: sk.id, label: sk.label, view: sk.view });
        closePlus();
        if (sk.view && global.switchViewAegis && sk.view === "aegis") global.switchViewAegis();
        var nav = document.querySelector('.nav-item[data-view="' + sk.view + '"]');
        if (nav) nav.click();
      });
    });
    document.querySelectorAll("[data-connector]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-connector");
        var c = CONNECTORS.filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        closePlus();
        if (c.href) window.open(c.href, "_blank", "noopener");
        else {
          var nav = document.querySelector('.nav-item[data-view="' + c.view + '"]');
          if (nav) nav.click();
        }
      });
    });
    var mic = $("mic-btn");
    if (mic) mic.addEventListener("click", startMic);
    var photo = $("photo-picker");
    if (photo) photo.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (file && global.NNACC_INGEST_FILE) global.NNACC_INGEST_FILE(file);
      e.target.value = "";
    });
  }

  global.ComposerBar = {
    init: wire,
    getChips: function () { return chips.slice(); },
    clearChips: function () { chips = []; renderChips(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
