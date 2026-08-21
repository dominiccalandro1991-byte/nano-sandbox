/**
 * Sidebar dock (desktop) / opaque drawer (mobile) + Settings cards.
 */
(function (global) {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }
  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }
  function setDrawer(open) {
    var sidebar = $("sidebar");
    var scrim = $("sidebar-scrim");
    if (!sidebar) return;
    if (!isMobile()) {
      sidebar.classList.toggle("collapsed", !open);
      sidebar.classList.toggle("open", open);
      if (scrim) scrim.hidden = true;
      document.body.classList.remove("drawer-open");
      return;
    }
    sidebar.classList.toggle("open", open);
    sidebar.classList.toggle("collapsed", !open);
    if (scrim) scrim.hidden = !open;
    document.body.classList.toggle("drawer-open", open);
  }

  function setRail(which) {
    document.querySelectorAll("#icon-rail [data-rail]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-rail") === which);
    });
    var app = $("app");
    var title = $("sidebar-panel-title");
    var labs = which === "labs" || which === "vault" || which === "aegis";
    if (app) {
      app.classList.toggle("show-labs", labs);
      app.setAttribute("data-panel", labs ? "labs" : "chats");
    }
    if (title) title.textContent = labs ? "Labs" : "Chats";
    if (which === "chats" || which === "search" || which === "labs") {
      setDrawer(true);
    }
  }

  function syncEmpty() {
    var view = $("view-chat");
    var list = $("message-list");
    if (!view) return;
    var n = list ? list.querySelectorAll(".msg").length : 0;
    view.classList.toggle("has-messages", n > 0);
  }

  function remoteUrl() {
    var el = $("setting-remote");
    var v = el && el.value ? el.value.trim() : "";
    if (!v) {
      try {
        v = localStorage.getItem("nnacc-v2-remote") || "";
      } catch (e) {}
    }
    return (v || "https://nano-sandbox-api.onrender.com").replace(/\/$/, "");
  }

  function testApi() {
    var st = $("api-test-status");
    var url = remoteUrl();
    if (st) st.textContent = "Checking…";
    var docs = $("api-docs-link");
    if (docs) docs.href = url + "/docs";
    fetch(url + "/health", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j, status: r.status };
        });
      })
      .then(function (x) {
        if (st) {
          st.textContent = x.ok
            ? "Live · " + (x.j.status || x.j.ok || "ok")
            : "HTTP " + x.status;
          st.className = "set-status " + (x.ok ? "ok" : "bad");
        }
      })
      .catch(function () {
        if (st) {
          st.textContent = "Unreachable";
          st.className = "set-status bad";
        }
      });
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
        global.SessionEngine.createSession({ title: "New chat" });
        if (global.HistoryRail) global.HistoryRail.refresh();
        location.reload();
      });
    }
    var testBtn = $("test-api-btn");
    if (testBtn) testBtn.addEventListener("click", testApi);
    var remote = $("setting-remote");
    if (remote) {
      remote.addEventListener("input", function () {
        var docs = $("api-docs-link");
        if (docs) docs.href = remoteUrl() + "/docs";
      });
    }
    document.querySelectorAll(".trait-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        chip.classList.toggle("on");
        var box = $("setting-instructions");
        if (!box) return;
        var traits = [];
        document.querySelectorAll(".trait-chip.on").forEach(function (c) {
          traits.push(c.getAttribute("data-trait"));
        });
        var body = box.value.replace(/\n?Traits:.*$/m, "").trim();
        box.value = body + (traits.length ? "\nTraits: " + traits.join(", ") : "");
      });
    });
    var aegis = $("settings-open-aegis");
    if (aegis) {
      aegis.addEventListener("click", function () {
        var sm = $("settings-modal");
        if (sm) sm.hidden = true;
        var a = document.querySelector('.nav-item[data-view="aegis"]');
        if (a) a.click();
        setRail("labs");
      });
    }
    try {
      var n = localStorage.getItem("vc-name");
      var r = localStorage.getItem("vc-role");
      var i = localStorage.getItem("vc-instructions");
      var a = localStorage.getItem("vc-accent");
      var lang = localStorage.getItem("vc-lang");
      var vlang = localStorage.getItem("vc-voice-lang");
      if (n && $("setting-name")) $("setting-name").value = n;
      if (r && $("setting-role")) $("setting-role").value = r;
      if (i && $("setting-instructions")) $("setting-instructions").value = i;
      if (lang && $("setting-lang")) $("setting-lang").value = lang;
      if (vlang && $("setting-voice-lang")) $("setting-voice-lang").value = vlang;
      if (a && $("setting-accent")) {
        $("setting-accent").value = a;
        document.documentElement.style.setProperty("--primary", a);
      }
      var savedRemote = localStorage.getItem("nnacc-v2-remote");
      if (savedRemote && $("setting-remote")) $("setting-remote").value = savedRemote;
    } catch (e) {}
  }

  function persistExtraSettings() {
    try {
      if ($("setting-name")) localStorage.setItem("vc-name", $("setting-name").value);
      if ($("setting-role")) localStorage.setItem("vc-role", $("setting-role").value);
      if ($("setting-instructions")) localStorage.setItem("vc-instructions", $("setting-instructions").value);
      if ($("setting-lang")) localStorage.setItem("vc-lang", $("setting-lang").value);
      if ($("setting-voice-lang")) localStorage.setItem("vc-voice-lang", $("setting-voice-lang").value);
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
        var chat = document.querySelector('.nav-item[data-view="chat"]');
        if (chat) chat.click();
        if (isMobile()) setDrawer(false);
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
        setRail("labs");
        var v = document.querySelector('.nav-item[data-view="vault"]');
        if (v) v.click();
        if (isMobile()) setDrawer(false);
        return;
      }
      if (which === "aegis") {
        setRail("labs");
        var a = document.querySelector('.nav-item[data-view="aegis"]');
        if (a) a.click();
        if (isMobile()) setDrawer(false);
        return;
      }
      if (which === "labs") {
        setRail("labs");
        return;
      }
      setRail("chats");
    });
  }

  function wireNavSync() {
    var nav = document.querySelector(".sidebar-nav");
    if (!nav) return;
    nav.addEventListener("click", function (ev) {
      var item = ev.target.closest(".nav-item");
      if (!item || item.id === "open-settings") return;
      var view = item.getAttribute("data-view");
      if (view === "chat") setRail("chats");
      else setRail("labs");
      if (isMobile() && view && view !== "chat") setDrawer(false);
    });
    var hist = $("session-history");
    if (hist) {
      hist.addEventListener("click", function (ev) {
        if (ev.target.closest(".session-open") && isMobile()) setDrawer(false);
      });
    }
    var scrim = $("sidebar-scrim");
    if (scrim) scrim.addEventListener("click", function () { setDrawer(false); });
    var close = $("sidebar-close");
    if (close) close.addEventListener("click", function () { setDrawer(false); });
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
        attachMessageActions(el, {
          role: "assistant",
          text: (el.querySelector(".msg-body") || el).textContent
        });
      });
    }
    obs = new MutationObserver(sweep);
    obs.observe(list, { childList: true });
    sweep();
  }

  global.ShellLayout = {
    init: function () {
      wireRail();
      wireNavSync();
      wireSuggest();
      wireSettings();
      watchMessages();
      if (isMobile()) {
        setRail("chats");
        setDrawer(false);
      } else {
        setRail("chats");
        setDrawer(true);
      }
    },
    syncEmpty: syncEmpty,
    persistExtraSettings: persistExtraSettings,
    attachMessageActions: attachMessageActions,
    setRail: setRail,
    setDrawer: setDrawer
  };
})(typeof window !== "undefined" ? window : globalThis);
