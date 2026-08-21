/**
 * Composer — live DDGS search, display/camera capture, voice waveform,
 * recent-files library, Pollinations image gen.
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
  var audioCtx = null;
  var analyser = null;
  var micStream = null;
  var waveRaf = 0;
  var lastSearch = null;
  var captureStream = null;

  function $(id) {
    return document.getElementById(id);
  }
  function toast(msg) {
    if (global.NNACC && global.NNACC.showToast) global.NNACC.showToast(msg);
    else if (global.showToast) global.showToast(msg);
  }
  function remoteBase() {
    try {
      if (global.__NNACC_REMOTE__ && /^https?:\/\//i.test(global.__NNACC_REMOTE__)) {
        return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      }
      var s = localStorage.getItem("nnacc-v2-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return "https://nano-sandbox-api.onrender.com";
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
    chips = chips.filter(function (c) { return c.id !== id; });
    renderChips();
  }
  function hasChip(kind) {
    return chips.some(function (c) { return c.kind === kind; });
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
      b.addEventListener("click", function () { removeChip(c.id); });
      el.appendChild(b);
    });
  }

  function paintRecent() {
    var box = $("plus-recent");
    if (!box) return;
    box.innerHTML = "";
    var files = (global.RecentFiles && global.RecentFiles.list()) || [];
    if (!files.length) {
      try {
        var s = global.SessionEngine && global.NNACC && global.NNACC.getActive && global.NNACC.getActive();
        files = ((s && s.files) || []).map(function (f) {
          return { id: f.id, name: f.name, ts: f.ingestedAt };
        });
      } catch (e) {}
    }
    if (!files.length) {
      box.innerHTML = '<p class="muted small">No recent files yet.</p>';
      return;
    }
    files.slice(0, 10).forEach(function (f) {
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

  function stopWave() {
    if (waveRaf) cancelAnimationFrame(waveRaf);
    waveRaf = 0;
    var canvas = $("voice-wave");
    if (canvas) {
      canvas.hidden = true;
      var ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }
    if (audioCtx && audioCtx.state !== "closed") {
      try { audioCtx.close(); } catch (e) {}
    }
    audioCtx = null;
  }

  function drawWave() {
    var canvas = $("voice-wave");
    if (!canvas || !analyser) return;
    var ctx = canvas.getContext("2d");
    var buf = new Uint8Array(analyser.frequencyBinCount);
    function frame() {
      analyser.getByteFrequencyData(buf);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      var n = 24;
      var gap = 2;
      var bar = (w - gap * n) / n;
      for (var i = 0; i < n; i++) {
        var v = buf[Math.floor((i / n) * buf.length)] / 255;
        var bh = Math.max(2, v * h);
        ctx.fillStyle = "rgba(61,139,253," + (0.35 + v * 0.65) + ")";
        ctx.fillRect(i * (bar + gap), (h - bh) / 2, bar, bh);
      }
      waveRaf = requestAnimationFrame(frame);
    }
    canvas.hidden = false;
    frame();
  }

  function startWaveform() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve();
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      drawWave();
    }).catch(function () {});
  }

  function startMic() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    var btn = $("mic-btn");
    if (listening) {
      if (rec) try { rec.stop(); } catch (e) {}
      stopWave();
      listening = false;
      if (btn) btn.classList.remove("live");
      return;
    }
    startWaveform();
    if (!SR) {
      toast("Waveform live — dictation needs Chrome or Safari");
      listening = true;
      if (btn) btn.classList.add("live");
      return;
    }
    rec = new SR();
    rec.lang = (($("setting-voice-lang") || {}).value) || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onstart = function () {
      listening = true;
      if (btn) btn.classList.add("live");
    };
    rec.onend = function () {
      listening = false;
      if (btn) btn.classList.remove("live");
      stopWave();
    };
    rec.onerror = function () {
      listening = false;
      if (btn) btn.classList.remove("live");
      stopWave();
    };
    rec.onresult = function (ev) {
      var t = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      var ta = $("composer-input");
      if (ta) {
        ta.value = (ta.value ? ta.value.replace(/\s+$/, "") + " " : "") + t.trim();
        ta.dispatchEvent(new Event("input"));
      }
    };
    rec.start();
  }

  function ingestBlob(blob, name) {
    var file = new File([blob], name, { type: blob.type || "image/png" });
    if (global.NNACC_INGEST_FILE) global.NNACC_INGEST_FILE(file);
    else toast("Vault ingest not ready");
  }

  function stopCapture() {
    if (captureStream) {
      captureStream.getTracks().forEach(function (t) { t.stop(); });
      captureStream = null;
    }
    var ov = $("capture-overlay");
    if (ov) ov.hidden = true;
    var video = $("capture-video");
    if (video) video.srcObject = null;
  }

  function snapCapture() {
    var video = $("capture-video");
    if (!video) return;
    var canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(function (blob) {
      if (blob) ingestBlob(blob, "capture-" + Date.now() + ".png");
      stopCapture();
    }, "image/png");
  }

  function openCapture(stream, title) {
    captureStream = stream;
    var ov = $("capture-overlay");
    var video = $("capture-video");
    var label = $("capture-title");
    if (label) label.textContent = title || "Capture";
    if (video) {
      video.srcObject = stream;
      video.play();
    }
    if (ov) ov.hidden = false;
    stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
  }

  function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast("Screen capture not supported here");
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      openCapture(stream, "Screenshot — snap a frame");
    }).catch(function (err) {
      if (err && err.name !== "NotAllowedError") toast("Screen capture failed");
    });
  }

  function captureCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var inp = $("photo-picker");
      if (inp) inp.click();
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (stream) {
      openCapture(stream, "Camera — snap a photo");
    }).catch(function () {
      var inp = $("photo-picker");
      if (inp) inp.click();
    });
  }

  function paintSearchResults(data) {
    var box = $("search-results");
    if (!box) return;
    var rows = (data && data.results) || [];
    lastSearch = data;
    if (!rows.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = "<strong>Web · " + (data.q || "") + "</strong>";
    rows.forEach(function (r) {
      var a = document.createElement("a");
      a.className = "search-hit";
      a.href = r.href || "#";
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = "<span>" + (r.title || r.href || "result") + "</span><small>" + (r.body || "") + "</small>";
      box.appendChild(a);
    });
  }

  function runSearch(q) {
    q = String(q || "").trim();
    if (!q) {
      toast("Type a query, then tap Web search");
      return Promise.resolve(null);
    }
    var box = $("search-results");
    if (box) {
      box.hidden = false;
      box.innerHTML = "<strong>Searching…</strong>";
    }
    return fetch(remoteBase() + "/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ q: q, max_results: 5 })
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      })
      .then(function (x) {
        if (!x.ok) {
          toast((x.j && (x.j.detail || x.j.error)) || "Search unavailable");
          if (box) box.hidden = true;
          return null;
        }
        paintSearchResults(x.j);
        addChip({ kind: "web", id: "web", label: "Web search" });
        var mode = $("mode-search");
        if (mode) { mode.classList.add("on"); mode.setAttribute("aria-pressed", "true"); }
        return x.j;
      })
      .catch(function () {
        toast("Search API unreachable (Render waking?)");
        if (box) box.hidden = true;
        return null;
      });
  }

  function consumeSearchContext(userText) {
    var mode = $("mode-search");
    var want = hasChip("web") || (mode && mode.getAttribute("aria-pressed") === "true");
    if (!want) return Promise.resolve(null);
    var p = lastSearch && lastSearch.q === userText
      ? Promise.resolve(lastSearch)
      : runSearch(userText);
    return p.then(function (data) {
      if (!data || !data.results || !data.results.length) return null;
      var block = data.results.map(function (r, i) {
        return (i + 1) + ". " + r.title + "\n" + r.href + "\n" + r.body;
      }).join("\n\n");
      return "Web search results for “" + data.q + "” (DuckDuckGo, $0):\n\n" + block;
    });
  }

  function generateImage(prompt) {
    prompt = String(prompt || "").trim();
    if (!prompt) {
      toast("Describe the image first");
      return Promise.resolve();
    }
    return fetch(remoteBase() + "/media/image?prompt=" + encodeURIComponent(prompt), {
      headers: { Accept: "application/json" }
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var url = j && j.url;
        if (!url) throw new Error("no image url");
        if (global.NNACC && global.NNACC.appendMessage) {
          global.NNACC.appendMessage({ role: "user", text: "Generate image: " + prompt });
          global.NNACC.appendMessage({
            role: "assistant",
            kind: "image",
            text: prompt,
            src: url,
            provider: j.provider || "pollinations"
          });
        } else {
          var list = $("message-list");
          if (list) {
            var img = document.createElement("img");
            img.className = "gen-image";
            img.src = url;
            img.alt = prompt;
            list.appendChild(img);
          }
        }
        toast("Image · " + (j.provider || "pollinations"));
        removeChip("image");
      })
      .catch(function () {
        toast("Image API unreachable");
      });
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
    var shotBtn = document.querySelector('[data-plus="screenshot"]');
    if (shotBtn) shotBtn.addEventListener("click", function () {
      closePlus();
      captureScreen();
    });
    var camBtn = document.querySelector('[data-plus="camera"]');
    if (camBtn) camBtn.addEventListener("click", function () {
      closePlus();
      captureCamera();
    });
    var photoBtn = document.querySelector('[data-plus="photo"]');
    if (photoBtn) photoBtn.addEventListener("click", function () {
      closePlus();
      captureScreen();
    });
    var webBtn = document.querySelector('[data-plus="web"]');
    if (webBtn) webBtn.addEventListener("click", function () {
      closePlus();
      var q = (($("composer-input") || {}).value || "").trim();
      runSearch(q || "voltage cipher");
    });
    var imgBtn = document.querySelector('[data-plus="image"]');
    if (imgBtn) imgBtn.addEventListener("click", function () {
      addChip({ kind: "image", id: "image", label: "Generate image" });
      closePlus();
      var q = (($("composer-input") || {}).value || "").trim();
      if (q) generateImage(q);
      else toast("Type a prompt, then send");
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
    var snap = $("capture-snap");
    if (snap) snap.addEventListener("click", snapCapture);
    var cancel = $("capture-cancel");
    if (cancel) cancel.addEventListener("click", stopCapture);
  }

  global.ComposerBar = {
    init: wire,
    getChips: function () { return chips.slice(); },
    clearChips: function () { chips = []; renderChips(); },
    hasChip: hasChip,
    consumeSearchContext: consumeSearchContext,
    generateImage: generateImage,
    shouldGenerateImage: function () { return hasChip("image"); },
    paintRecent: paintRecent
  };
})(typeof window !== "undefined" ? window : globalThis);
