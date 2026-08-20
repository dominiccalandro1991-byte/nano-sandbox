/**
 * ChatGPT / Grok / Claude / Gemini / Perplexity shell:
 * icon rail + history column + empty greeting + two-pane settings.
 */
(function (global) {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function setRail(which) {
    document.querySelectorAll("#icon-rail [data-rail]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-rail") === which);
    });
    var app = $("app");
    var sidebar = $("sidebar");
    if (app) app.classList.toggle("show-labs", which === "labs");
    if (sidebar && (which === "chats" || which === "search" || which === "labs")) {
      sidebar.classList.add("open");
      sidebar.classList.remove("collapsed");
    }
  }

  function syncEmpty() {
    var view = $("view-chat");
    var list = $("message-list");
    if (!view) return;
    var n = list ? list.querySelectorAll(".msg").length : 0;
    view.classList.toggle("has-messages", n > 0);
  }

  function wireSettings() {
    document.querySelectorAll(".set-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-set");
        document.querySelectorAll(".set-tab").forEach(function (t) {
          t.classList.toggle("on", t === tab);
        });
        document.querySelectorAll(".set-pane").forEach(function (p) {
          p.classList.toggle("on", p.getAttribute("data-pane") === id);
        });
      });
    });
    var clear = $("clear-history-btn");
    if (clear) {
      clear.addEventListener("click", function () {
        if (!global.SessionEngine) return;
        if (!window.confirm("Delete every chat on this device?")) return;
        (global.SessionEngine.listSessions() || []).forEach(function (e) {
          global.SessionEngine.deleteSession(e.id);
        });
        var s = global.SessionEngine.createSession({ title: "New chat" });
        if (global.HistoryRail) global.HistoryRail.refresh();
        location.reload();
      });
    }
    try {
      var n = localStorage.getItem("vc-name");
      var r = localStorage.getItem("vc-role");
      var i = localStorage.getItem("vc-instructions");
      var a = localStorage.getItem("vc-accent");
      if (n && $("setting-name")) $("setting-name").value = n;
      if (r && $("setting-role")) $("setting-role").value = r;
      if (i && $("setting-instructions")) $("setting-instructions").value = i;
      if (a && $("setting-accent")) {
        $("setting-accent").value = a;
        document.documentElement.style.setProperty("--primary", a);
      }
    } catch (e) {}
  }

  function persistExtraSettings() {
    try {
      if ($("setting-name")) localStorage.setItem("vc-name", $("setting-name").value);
      if ($("setting-role")) localStorage.setItem("vc-role", $("setting-role").value);
      if ($("setting-instructions")) localStorage.setItem("vc-instructions", $("setting-instructions").value);
      if ($("setting-accent")) {
        localStorage.setItem("vc-accent", $("setting-accent").value);
        document.documentElement.style.setProperty("--primary", $("setting-accent").value);
      }
    } catch (e) {}
  }

  function wireRail() {
    var rail = $("icon-rail");
    if (!rail) return;
    rail.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-rail]");
      if (!btn) return;
      var which = btn.getAttribute("data-rail");
      if (which === "new") {
        var nc = $("new-chat-btn");
        if (nc) nc.click();
        setRail("chats");
        return;
      }
      if (which === "search") {
        setRail("chats");
        var s = $("history-search");
        if (s) s.focus();
        return;
      }
      if (which === "settings") {
        var sm = $("settings-modal");
        if (sm) sm.hidden = false;
        return;
      }
      if (which === "vault") {
        var v = document.querySelector('.nav-item[data-view="vault"]');
        if (v) v.click();
        return;
      }
      if (which === "aegis") {
        var a = document.querySelector('.nav-item[data-view="aegis"]');
        if (a) a.click();
        return;
      }
      if (which === "labs") {
        setRail("labs");
        return;
      }
      setRail("chats");
    });
  }

  function wireSuggest() {
    document.querySelectorAll(".suggest-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var k = chip.getAttribute("data-suggest");
        if (k === "stress") {
          var n = document.querySelector('.nav-item[data-view="vste"]');
          if (n) n.click();
        } else if (k === "studio") {
          var s = document.querySelector('.nav-item[data-view="studio"]');
          if (s) s.click();
        } else if (k === "research") {
          var r = document.querySelector('.nav-item[data-view="engine-chat"][data-macro="research"]');
          if (r) r.click();
        } else if (k === "files") {
          var plus = $("plus-btn");
          if (plus) plus.click();
        }
      });
    });
    ["mode-search", "mode-reason"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("click", function () {
        var on = el.getAttribute("aria-pressed") === "true";
        el.setAttribute("aria-pressed", on ? "false" : "true");
        el.classList.toggle("on", !on);
      });
    });
  }

  function attachMessageActions(el, msg) {
    if (!el || !msg || msg.role !== "assistant") return;
    if (el.querySelector(".msg-actions")) return;
    var bar = document.createElement("div");
    bar.className = "msg-actions";
    [["Copy", "copy"], ["Read", "read"], ["Retry", "retry"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "msg-act";
      b.textContent = pair[0];
      b.addEventListener("click", function () {
        if (pair[1] === "copy") navigator.clipboard.writeText(msg.text || "");
        if (pair[1] === "read" && global.speechSynthesis) {
          var u = new SpeechSynthesisUtterance(msg.text || "");
          global.speechSynthesis.cancel();
          global.speechSynthesis.speak(u);
        }
        if (pair[1] === "retry") {
          var ta = $("composer-input");
          if (ta) {
            ta.value = "Retry that last answer with more precision.";
            var send = $("send-btn");
            if (send) send.click();
          }
        }
      });
      bar.appendChild(b);
    });
    el.appendChild(bar);
  }

  var obs;
  function watchMessages() {
    var list = $("message-list");
    if (!list || obs) return;
    function sweep() {
      syncEmpty();
      list.querySelectorAll(".msg.assistant").forEach(function (el) {
        attachMessageActions(el, { role: "assistant", text: (el.querySelector(".msg-body") || el).textContent });
      });
    }
    obs = new MutationObserver(sweep);
    obs.observe(list, { childList: true });
    sweep();
  }

  global.ShellLayout = {
    init: function () {
      wireRail();
      wireSuggest();
      wireSettings();
      watchMessages();
      setRail("chats");
    },
    syncEmpty: syncEmpty,
    persistExtraSettings: persistExtraSettings,
    attachMessageActions: attachMessageActions
  };
})(typeof window !== "undefined" ? window : globalThis);
