/**
 * app.js — Voltage Cipher Studio bindings, chat renderer, AEGIS trigger
 */
(function () {
  "use strict";

  var avatar = null;
  var sessions = [];
  var activeSessionId = null;
  var streaming = false;

  function $(sel) {
    return document.querySelector(sel);
  }

  function uid() {
    return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadSessions() {
    try {
      sessions = JSON.parse(localStorage.getItem("vcs-sessions") || "[]");
    } catch (e) {
      sessions = [];
    }
    if (!sessions.length) {
      sessions.push({ id: uid(), title: "New chat", messages: [], updated: Date.now() });
    }
    activeSessionId = localStorage.getItem("vcs-active-session") || sessions[0].id;
    if (!sessions.some(function (s) { return s.id === activeSessionId; })) {
      activeSessionId = sessions[0].id;
    }
  }

  function saveSessions() {
    try {
      localStorage.setItem("vcs-sessions", JSON.stringify(sessions.slice(0, 40)));
      localStorage.setItem("vcs-active-session", activeSessionId);
    } catch (e) {}
  }

  function activeSession() {
    return (
      sessions.filter(function (s) {
        return s.id === activeSessionId;
      })[0] || sessions[0]
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Markdown-lite: code fences + bold + italics + newlines */
  function formatMessageHtml(text) {
    var escaped = escapeHtml(text);
    escaped = escaped.replace(/```([\w-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return (
        '<div class="code-block-wrap"><div class="code-block-bar"><span>' +
        escapeHtml(lang || "code") +
        '</span><button type="button" class="copy-code-btn">Copy Code</button></div><pre class="code-block"><code>' +
        code.replace(/^\n/, "") +
        "</code></pre></div>"
      );
    });
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/_([^_]+)_/g, "<em>$1</em>");
    escaped = escaped.replace(/`([^`]+)`/g, "<code class=\"inline-code\">$1</code>");
    escaped = escaped.replace(/^&gt; (.+)$/gm, '<div class="quote">$1</div>');
    escaped = escaped.replace(/\n/g, "<br>");
    return escaped;
  }

  function renderHistoryList() {
    var el = $("#session-history");
    if (!el) return;
    el.innerHTML = "";
    sessions
      .slice()
      .sort(function (a, b) {
        return (b.updated || 0) - (a.updated || 0);
      })
      .forEach(function (s) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "session-item" + (s.id === activeSessionId ? " active" : "");
        btn.innerHTML =
          '<span class="session-title"></span><span class="session-meta"></span>';
        btn.querySelector(".session-title").textContent = s.title || "Untitled";
        btn.querySelector(".session-meta").textContent = String((s.messages || []).length);
        btn.addEventListener("click", function () {
          activeSessionId = s.id;
          saveSessions();
          renderHistoryList();
          renderMessages();
        });
        el.appendChild(btn);
      });
  }

  function renderMessages() {
    var list = $("#message-list");
    if (!list) return;
    var sess = activeSession();
    list.innerHTML = "";
    (sess.messages || []).forEach(function (m) {
      list.appendChild(buildBubble(m));
    });
    list.scrollTop = list.scrollHeight;
    list.querySelectorAll(".copy-code-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = btn.closest(".code-block-wrap");
        var code = pre ? pre.querySelector("code") : null;
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code.textContent || "").then(function () {
            btn.textContent = "Copied";
            setTimeout(function () {
              btn.textContent = "Copy Code";
            }, 1200);
          });
        }
      });
    });
  }

  function buildBubble(m) {
    var div = document.createElement("div");
    div.className = "msg msg-" + (m.role || "assistant");
    var meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent =
      (m.role === "user" ? "You" : m.speaker || "Studio") +
      (m.mode ? " · " + m.mode : "") +
      (m.hash ? " · hash logged" : "");
    var body = document.createElement("div");
    body.className = "msg-body";
    if (m.role === "user") body.textContent = m.text || "";
    else body.innerHTML = formatMessageHtml(m.text || "");
    div.appendChild(meta);
    div.appendChild(body);
    if (m.hash) {
      var h = document.createElement("div");
      h.className = "msg-hash";
      h.textContent = "S_attest / hash: " + m.hash.slice(0, 18) + "…";
      h.title = m.hash;
      div.appendChild(h);
    }
    return div;
  }

  function updatePersonaStage(targetKey) {
    var t = window.EngineRouter.resolveTarget(targetKey);
    var nameEl = $("#persona-name");
    var tagEl = $("#persona-tagline");
    var glyphEl = $("#persona-glyph");
    var stage = $("#persona-stage");
    if (t.kind === "persona" && t.persona) {
      if (nameEl) nameEl.textContent = t.persona.name;
      if (tagEl) tagEl.textContent = t.persona.tagline;
      if (glyphEl) glyphEl.textContent = t.persona.glyph;
      if (stage) stage.style.setProperty("--persona-accent", t.persona.accent);
    } else if (t.engine) {
      if (nameEl) nameEl.textContent = t.engine.label;
      if (tagEl) tagEl.textContent = "System engine · " + t.engine.group;
      if (glyphEl) glyphEl.textContent = "▣";
      if (stage) stage.style.setProperty("--persona-accent", "#00ff9d");
    }
  }

  async function handleSend() {
    if (streaming) return;
    var input = $("#composer-input");
    var select = $("#chat-target-select");
    var text = (input && input.value || "").trim();
    if (!text) return;
    var targetKey = select ? select.value : "persona:vail-cipher";
    var sess = activeSession();
    sess.messages.push({ role: "user", text: text, ts: Date.now() });
    if (sess.title === "New chat") sess.title = text.slice(0, 42);
    sess.updated = Date.now();
    input.value = "";
    autoResize(input);
    renderMessages();
    renderHistoryList();
    saveSessions();

    streaming = true;
    if (avatar) avatar.thinking();
    var assistant = {
      role: "assistant",
      text: "",
      speaker: "…",
      mode: "",
      hash: null,
      ts: Date.now()
    };
    sess.messages.push(assistant);
    renderMessages();

    var onToken = function (chunk) {
      if (avatar && avatar.state !== "BUILDING") avatar.building();
      assistant.text += chunk;
      var list = $("#message-list");
      var last = list && list.querySelector(".msg-assistant:last-child .msg-body");
      if (last) last.innerHTML = formatMessageHtml(assistant.text);
      if (list) list.scrollTop = list.scrollHeight;
    };

    try {
      var result = await window.EngineRouter.sendMessage(targetKey, text, {
        onToken: onToken,
        preferLive: true
      });
      assistant.text = (result.unpacked && result.unpacked.text) || assistant.text;
      assistant.hash = (result.unpacked && result.unpacked.hash) || null;
      assistant.mode = result.mode;
      if (result.target.kind === "persona") assistant.speaker = result.target.persona.name;
      else assistant.speaker = result.target.engine.label;
      if (avatar) avatar.celebrate();
    } catch (err) {
      assistant.text = "Fault: " + (err && err.message ? err.message : String(err));
      assistant.mode = "error";
      if (avatar) avatar.error();
      setTimeout(function () {
        if (avatar) avatar.idle();
      }, 2500);
    }
    streaming = false;
    sess.updated = Date.now();
    saveSessions();
    renderMessages();
    renderHistoryList();
  }

  function autoResize(ta) {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(160, Math.max(44, ta.scrollHeight)) + "px";
  }

  function toggleSidebar(force) {
    var sb = $("#sidebar");
    if (!sb) return;
    if (force === true) sb.classList.add("open");
    else if (force === false) sb.classList.remove("open");
    else sb.classList.toggle("open");
  }

  function wire() {
    loadSessions();
    avatar = new window.AvatarController("#persona-stage");

    var select = $("#chat-target-select");
    if (select && window.EngineRouter) {
      select.innerHTML = window.EngineRouter.listSelectOptions();
      select.value = "persona:vail-cipher";
      select.addEventListener("change", function () {
        updatePersonaStage(select.value);
      });
      updatePersonaStage(select.value);
    }

    var sendBtn = $("#send-btn");
    var input = $("#composer-input");
    if (sendBtn) sendBtn.addEventListener("click", handleSend);
    if (input) {
      input.addEventListener("input", function () {
        autoResize(input);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    var newChat = $("#new-chat-btn");
    if (newChat)
      newChat.addEventListener("click", function () {
        var s = { id: uid(), title: "New chat", messages: [], updated: Date.now() };
        sessions.unshift(s);
        activeSessionId = s.id;
        saveSessions();
        renderHistoryList();
        renderMessages();
        toggleSidebar(false);
      });

    var toggle = $("#sidebar-toggle");
    var close = $("#sidebar-close");
    if (toggle) toggle.addEventListener("click", function () { toggleSidebar(); });
    if (close) close.addEventListener("click", function () { toggleSidebar(false); });

    var aegis = $("#run-aegis-sweep");
    if (aegis) {
      aegis.addEventListener("click", function () {
        aegis.disabled = true;
        var prev = aegis.textContent;
        aegis.textContent = "Running…";
        var base =
          (window.EngineRouter && window.EngineRouter.backendBase()) ||
          "https://nano-sandbox-api.onrender.com";
        Promise.all([
          fetch(base + "/health").then(function (r) { return r.json(); }).catch(function () { return { status: "offline" }; }),
          fetch(base + "/nase/macros").then(function (r) { return r.json(); }).catch(function () { return null; })
        ])
          .then(function (pair) {
            var health = pair[0];
            var macros = pair[1];
            var ok = health && health.status === "ok";
            var msg =
              "AEGIS diagnostic: backend " +
              (ok ? "ONLINE" : "DEGRADED") +
              " · health=" +
              JSON.stringify(health) +
              (macros && macros.macros
                ? " · macros=" + macros.macros.length
                : " · macros unavailable");
            var sess = activeSession();
            sess.messages.push({
              role: "assistant",
              text: msg,
              speaker: "AEGIS",
              mode: ok ? "live" : "error",
              ts: Date.now()
            });
            saveSessions();
            renderMessages();
            if (avatar) {
              if (ok) avatar.celebrate();
              else avatar.error();
            }
          })
          .finally(function () {
            aegis.disabled = false;
            aegis.textContent = prev;
          });
      });
    }

    var remote = $("#setting-remote");
    if (remote) {
      try {
        remote.value =
          localStorage.getItem("vcs-remote") ||
          localStorage.getItem("nnacc-v2-remote") ||
          "https://nano-sandbox-api.onrender.com";
      } catch (e) {}
    }
    var saveRemote = $("#save-remote");
    if (saveRemote && remote) {
      saveRemote.addEventListener("click", function () {
        var v = remote.value.trim();
        try {
          localStorage.setItem("vcs-remote", v);
          localStorage.setItem("nnacc-v2-remote", v);
          window.__NNACC_REMOTE__ = v;
        } catch (e) {}
        saveRemote.textContent = "Saved";
        setTimeout(function () {
          saveRemote.textContent = "Save";
        }, 1000);
      });
    }

    renderHistoryList();
    renderMessages();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
