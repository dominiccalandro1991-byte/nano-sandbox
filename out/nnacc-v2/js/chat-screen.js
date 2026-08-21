/**
 * Block A — Chat screen: empty hero, temporary threads, share, thumbs, regenerate.
 */
(function (global) {
  "use strict";

  function $(id) {
    return document.getElementById(id);
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
  function originShareBase() {
    var loc = global.location;
    var path = (loc.pathname || "/").replace(/index\.html$/, "");
    if (!path.endsWith("/")) path += "/";
    return loc.origin + path;
  }
  function toast(msg) {
    if (global.NNACC && global.NNACC.showToast) global.NNACC.showToast(msg);
  }
  function active() {
    return (global.NNACC && global.NNACC.getActive && global.NNACC.getActive()) || null;
  }

  function userFacingCount(list) {
    if (!list) return 0;
    return list.querySelectorAll(".msg.user, .msg.assistant, .msg.file-badge-msg").length;
  }

  function syncEmpty() {
    var view = $("view-chat");
    var list = $("message-list");
    if (!view) return;
    view.classList.toggle("has-messages", userFacingCount(list) > 0);
  }

  function syncTempBanner() {
    var s = active();
    var banner = $("temp-banner");
    var btn = $("temp-chat-btn");
    if (banner) banner.hidden = !(s && s.temporary);
    if (btn) btn.classList.toggle("on", !!(s && s.temporary));
    document.body.classList.toggle("temporary-chat", !!(s && s.temporary));
  }

  function startTemporary() {
    if (global.NNACC && global.NNACC.startNewChat) {
      global.NNACC.startNewChat({ temporary: true });
    } else if (global.SessionEngine) {
      var s = global.SessionEngine.createSession({ title: "Temporary chat", temporary: true });
      if (global.NNACC && global.NNACC.hydrateFromSession) global.NNACC.hydrateFromSession(s);
    }
    syncTempBanner();
    syncEmpty();
    toast("Temporary chat — not saved");
  }

  function saveTempToHistory() {
    var s = active();
    if (!s || !global.SessionEngine || !global.SessionEngine.persistToHistory) return;
    global.SessionEngine.persistToHistory(s);
    if (global.NNACC && global.NNACC.persistActive) global.NNACC.persistActive();
    syncTempBanner();
    toast("Saved to history");
  }

  function transcriptMarkdown(session) {
    var lines = ["# " + ((session && session.title) || "Shared chat"), ""];
    ((session && session.messages) || []).forEach(function (m) {
      if (!m || m.role === "system") return;
      if (m.kind === "file-badge") {
        lines.push("**user** · file: " + (m.fileName || m.text));
      } else {
        lines.push("**" + m.role + "**");
        lines.push("");
        lines.push(m.text || m.content || "");
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  function openShareModal() {
    var modal = $("share-modal");
    if (modal) modal.hidden = false;
    var input = $("share-url");
    if (input) input.value = "Creating link…";
    var session = active();
    if (!session) return;
    fetch(remoteBase() + "/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        title: session.title || "Shared chat",
        messages: (session.messages || []).map(function (m) {
          return { role: m.role, text: m.text || m.content || "", ts: m.ts, kind: m.kind };
        })
      })
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        var url = originShareBase() + (x.ok && x.j.id ? "#share/" + x.j.id : "");
        if (input) input.value = url || "Link unavailable — copy transcript instead";
        if (x.ok && x.j.id) {
          try {
            navigator.clipboard.writeText(url);
            toast("Share link copied");
          } catch (e) {}
        }
      })
      .catch(function () {
        if (input) input.value = "API unreachable — use Copy transcript";
      });
  }

  function loadShareFromHash() {
    var hash = String((global.location && global.location.hash) || "");
    var m = hash.match(/^#share\/([a-zA-Z0-9_-]+)/);
    if (!m) return false;
    var id = m[1];
    fetch(remoteBase() + "/shares/" + encodeURIComponent(id), { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(function (row) {
        var session = {
          id: "share_" + id,
          title: row.title || "Shared chat",
          messages: row.messages || [],
          files: [],
          temporary: true,
          readOnly: true
        };
        if (global.NNACC && global.NNACC.hydrateFromSession) global.NNACC.hydrateFromSession(session);
        var banner = $("share-banner");
        if (banner) {
          banner.hidden = false;
          banner.querySelector("strong") && (banner.querySelector("strong").textContent = session.title);
        }
        var dz = $("drop-zone");
        if (dz) dz.style.display = "none";
        toast("Opened shared snapshot");
        syncEmpty();
      })
      .catch(function () {
        toast("Share link expired or not found");
      });
    return true;
  }

  function setFeedback(msgId, value) {
    var s = active();
    if (!s || !s.messages) return;
    s.messages.forEach(function (m) {
      if (m.id === msgId) m.feedback = m.feedback === value ? null : value;
    });
    if (global.NNACC && global.NNACC.persistActive) global.NNACC.persistActive();
    var el = document.querySelector('.msg[data-id="' + msgId + '"]');
    if (el) {
      el.querySelectorAll("[data-fb]").forEach(function (b) {
        var msg = (s.messages || []).filter(function (x) { return x.id === msgId; })[0];
        b.classList.toggle("on", !!(msg && msg.feedback === b.getAttribute("data-fb")));
      });
    }
  }

  function regenerate(msgId) {
    if (!global.NNACC || !global.NNACC.sendMessage) return;
    var s = active();
    if (!s) return;
    var msgs = s.messages || [];
    var idx = -1;
    if (msgId) {
      for (var i = 0; i < msgs.length; i++) if (msgs[i].id === msgId) idx = i;
    } else {
      for (var j = msgs.length - 1; j >= 0; j--) if (msgs[j].role === "assistant") { idx = j; break; }
    }
    if (idx < 0) return;
    var user = null;
    for (var k = idx - 1; k >= 0; k--) {
      if (msgs[k].role === "user" && msgs[k].kind !== "file-badge") {
        user = msgs[k];
        break;
      }
    }
    if (!user) return;
    var removed = msgs.splice(idx, 1)[0];
    var node = document.querySelector('.msg[data-id="' + (removed && removed.id) + '"]');
    if (node) node.remove();
    if (global.NNACC.persistActive) global.NNACC.persistActive();
    global.NNACC.sendMessage(user.text || user.content, { regenerate: true });
  }

  function attachMessageActions(el, msg) {
    if (!el || !msg || msg.role !== "assistant") return;
    var existing = el.querySelector(".msg-actions");
    if (existing) existing.remove();
    var bar = document.createElement("div");
    bar.className = "msg-actions";
    function add(label, key, title) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "msg-act";
      b.setAttribute("data-act", key);
      if (key === "up" || key === "down") {
        b.setAttribute("data-fb", key);
        if (msg.feedback === key) b.classList.add("on");
      }
      b.title = title || label;
      b.textContent = label;
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (key === "copy") {
          navigator.clipboard.writeText(msg.text || "").then(function () { toast("Copied"); });
        } else if (key === "up") setFeedback(msg.id, "up");
        else if (key === "down") setFeedback(msg.id, "down");
        else if (key === "regen") regenerate(msg.id);
        else if (key === "read" && global.speechSynthesis) {
          var u = new SpeechSynthesisUtterance(msg.text || "");
          global.speechSynthesis.cancel();
          global.speechSynthesis.speak(u);
        }
      });
      bar.appendChild(b);
    }
    add("Copy", "copy", "Copy");
    add("▲", "up", "Good response");
    add("▼", "down", "Bad response");
    add("↻", "regen", "Regenerate");
    add("Read", "read", "Read aloud");
    el.appendChild(bar);
  }

  function wire() {
    var tempBtn = $("temp-chat-btn");
    if (tempBtn) tempBtn.addEventListener("click", startTemporary);
    var exitTemp = $("exit-temp-btn");
    if (exitTemp) exitTemp.addEventListener("click", saveTempToHistory);
    var shareBtn = $("share-chat-btn");
    if (shareBtn) shareBtn.addEventListener("click", openShareModal);
    var closeShare = $("close-share");
    if (closeShare) closeShare.addEventListener("click", function () {
      var m = $("share-modal");
      if (m) m.hidden = true;
    });
    var copyLink = $("copy-share-link");
    if (copyLink) copyLink.addEventListener("click", function () {
      var v = ($("share-url") || {}).value || "";
      if (v) navigator.clipboard.writeText(v).then(function () { toast("Link copied"); });
    });
    var copyMd = $("copy-share-md");
    if (copyMd) copyMd.addEventListener("click", function () {
      navigator.clipboard.writeText(transcriptMarkdown(active())).then(function () { toast("Transcript copied"); });
    });
    global.addEventListener("hashchange", function () { loadShareFromHash(); });
  }

  global.ChatScreen = {
    init: function () {
      wire();
      if (!loadShareFromHash()) {
        syncEmpty();
        syncTempBanner();
      }
    },
    syncEmpty: syncEmpty,
    syncChrome: function () {
      syncEmpty();
      syncTempBanner();
    },
    attachMessageActions: attachMessageActions,
    startTemporary: startTemporary,
    regenerate: regenerate
  };
})(typeof window !== "undefined" ? window : globalThis);
