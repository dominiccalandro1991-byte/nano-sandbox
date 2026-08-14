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
    (sess.messages || []).forEach(function (m, idx) {
      list.appendChild(buildBubble(m, idx));
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

  function buildBubble(m, index) {
    var div = document.createElement("div");
    div.className = "msg msg-" + (m.role || "assistant") + (m.failed ? " msg-failed" : "");
    div.dataset.msgIndex = String(index != null ? index : "");
    var meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent =
      (m.role === "user" ? "You" : m.speaker || "Studio") +
      (m.mode ? " · " + m.mode : "") +
      (m.model ? " · " + m.model.split("/").pop() : "");
    var body = document.createElement("div");
    body.className = "msg-body";
    if (m.role === "user") body.textContent = m.text || "";
    else body.innerHTML = formatMessageHtml(m.text || "");
    var actions = document.createElement("div");
    actions.className = "msg-actions";
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "msg-action-btn msg-copy-btn";
    copyBtn.title = "Copy message";
    copyBtn.setAttribute("aria-label", "Copy message");
    copyBtn.innerHTML = "📋";
    copyBtn.addEventListener("click", function () {
      var t = m.text || "";
      if (navigator.clipboard) {
        navigator.clipboard.writeText(t).then(function () {
          copyBtn.textContent = "✓";
          setTimeout(function () {
            copyBtn.innerHTML = "📋";
          }, 1000);
        });
      }
    });
    actions.appendChild(copyBtn);
    if (m.role === "assistant" || m.failed) {
      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "msg-action-btn msg-retry-btn";
      retryBtn.title = "Retry / regenerate";
      retryBtn.setAttribute("aria-label", "Retry generation");
      retryBtn.innerHTML = "↻";
      retryBtn.addEventListener("click", function () {
        retryFromMessage(index);
      });
      actions.appendChild(retryBtn);
    }
    div.appendChild(meta);
    div.appendChild(body);
    div.appendChild(actions);
    return div;
  }

  function retryFromMessage(index) {
    var sess = activeSession();
    if (!sess || streaming) return;
    var msgs = sess.messages || [];
    var i = Number(index);
    if (isNaN(i) || i < 0 || i >= msgs.length) return;
    // Find nearest user prompt at or before this index
    var userText = null;
    for (var j = i; j >= 0; j--) {
      if (msgs[j].role === "user") {
        userText = msgs[j].text;
        break;
      }
    }
    if (!userText) return;
    // Drop this assistant message and anything after the user turn's following assistants
    // Simpler: remove from the user message's next index onward, then resend
    var userIdx = -1;
    for (var k = i; k >= 0; k--) {
      if (msgs[k].role === "user" && msgs[k].text === userText) {
        userIdx = k;
        break;
      }
    }
    if (userIdx < 0) return;
    sess.messages = msgs.slice(0, userIdx);
    saveSessions();
    renderMessages();
    var input = $("#composer-input");
    if (input) input.value = userText;
    handleSend();
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
    var modelEl = $("#model-select");
    var modelId =
      (modelEl && modelEl.value) ||
      (window.EngineRouter && window.EngineRouter.DEFAULT_MODEL) ||
      "google/gemma-4-26b-a4b-it:free";
    try {
      localStorage.setItem("vcs-model", modelId);
    } catch (e) {}
    if (avatar) {
      if (targetKey.indexOf("persona:") === 0) {
        avatar.setArtist(targetKey.slice(8));
      }
      avatar.isThinking();
    }
    var assistant = {
      role: "assistant",
      text: "",
      speaker: "…",
      mode: "",
      hash: null,
      model: modelId,
      failed: false,
      ts: Date.now()
    };
    sess.messages.push(assistant);
    renderMessages();

    var onToken = function (chunk) {
      if (avatar) avatar.isStreaming();
      assistant.text += chunk;
      var list = $("#message-list");
      var last = list && list.querySelector(".msg-assistant:last-child .msg-body");
      if (last) last.innerHTML = formatMessageHtml(assistant.text);
      if (list) list.scrollTop = list.scrollHeight;
    };

    try {
      var history = (sess.messages || [])
        .filter(function (m) {
          return m !== assistant && (m.role === "user" || m.role === "assistant") && m.text;
        })
        .slice(-12)
        .map(function (m) {
          return { role: m.role, content: m.text };
        });
      // last user is already being sent as userMessage — drop trailing duplicate if present
      var result = await window.EngineRouter.sendMessage(targetKey, text, {
        onToken: onToken,
        preferLive: true,
        model: modelId,
        history: history.filter(function (m, idx, arr) {
          return !(idx === arr.length - 1 && m.role === "user" && m.content === text);
        })
      });
      assistant.text = (result.unpacked && result.unpacked.text) || assistant.text;
      assistant.hash = (result.unpacked && result.unpacked.hash) || null;
      assistant.mode = result.mode;
      assistant.model = result.model || modelId;
      assistant.failed = false;
      if (result.target.kind === "persona") assistant.speaker = result.target.persona.name;
      else assistant.speaker = result.target.engine.label;
      if (avatar) avatar.onSuccess({ mode: result.mode, model: assistant.model });
    } catch (err) {
      assistant.text = "Fault: " + (err && err.message ? err.message : String(err));
      assistant.mode = "error";
      assistant.failed = true;
      if (avatar) avatar.onError({ message: assistant.text });
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
        if (avatar && select.value.indexOf("persona:") === 0) {
          avatar.setArtist(select.value.slice(8));
        }
      });
      updatePersonaStage(select.value);
    }
    var modelSelect = $("#model-select");
    if (modelSelect && window.EngineRouter) {
      modelSelect.innerHTML = window.EngineRouter.modelSelectOptionsHtml();
      var savedModel = null;
      try {
        savedModel = localStorage.getItem("vcs-model");
      } catch (e) {}
      modelSelect.value =
        savedModel || window.EngineRouter.DEFAULT_MODEL || "google/gemma-4-26b-a4b-it:free";
      if (![].slice.call(modelSelect.options).some(function (o) { return o.value === modelSelect.value; })) {
        modelSelect.value = window.EngineRouter.DEFAULT_MODEL;
      }
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
      aegis.addEventListener("click", async function () {
        var statusBadge = document.querySelector(".badge");
        if (statusBadge) statusBadge.textContent = "SWEEPING...";
        aegis.disabled = true;
        try {
          var base =
            (window.EngineRouter && window.EngineRouter.backendBase()) ||
            "https://nano-sandbox-api.onrender.com";
          var res = await fetch(base + "/health");
          var data = await res.json();
          // Update badge/console only — DO NOT append to chat
          if (statusBadge) {
            statusBadge.textContent =
              "AEGIS LIVE" + (data && data.version ? " (" + data.version + ")" : "");
          }
          console.log("[AEGIS System Diagnostic]:", data);
        } catch (err) {
          if (statusBadge) statusBadge.textContent = "AEGIS OFFLINE";
          console.error("[AEGIS Sweep Failed]:", err);
        } finally {
          aegis.disabled = false;
        }
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
