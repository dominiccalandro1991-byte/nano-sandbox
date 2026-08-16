/**
 * Chat-first shell (ChatGPT / Claude mobile pattern)
 * Home = Voltage Cipher Studio chat + 6 models
 * Menu drawer = engines, AEGIS, settings
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var streaming = false;

  function openDrawer(yes) {
    var d = $("drawer");
    var b = $("drawer-backdrop");
    if (!d || !b) return;
    if (yes) {
      d.hidden = false;
      b.hidden = false;
    } else {
      d.hidden = true;
      b.hidden = true;
    }
  }

  function showScreen(name) {
    ["screen-chat", "screen-work", "screen-settings"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === "screen-" + name) {
        el.hidden = false;
        el.classList.add("active");
      } else {
        el.hidden = true;
        el.classList.remove("active");
      }
    });
    var titles = {
      chat: ["Voltage Cipher Studio", "6 free models · multi-persona"],
      work: ["Workspace", "Engine / diagnostic tools"],
      settings: ["Settings", "API, vault, thread, health"]
    };
    var t = titles[name] || titles.chat;
    if ($("screen-title")) $("screen-title").textContent = t[0];
    if ($("screen-sub")) $("screen-sub").textContent = t[1];
  }

  function renderMessages() {
    var list = $("message-list");
    if (!list || !window.ChatPartition) return;
    var st = window.ChatPartition.getState();
    list.innerHTML = "";
    if (!st.messages.length) return;

    st.messages.forEach(function (m) {
      var div = document.createElement("div");
      div.className = "msg " + m.role + (m.failed ? " failed" : "");
      var meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent =
        m.role === "user" ? "You" : (st.persona && st.persona.name) || "Assistant";
      var body = document.createElement("div");
      body.className = "msg-body";
      body.textContent = m.content || "";
      div.appendChild(meta);
      div.appendChild(body);
      if (m.files && m.files.length && window.CodegenUtils) {
        var tree = document.createElement("div");
        tree.innerHTML = window.CodegenUtils.renderFileTreeHtml(m.files);
        div.appendChild(tree);
        tree.querySelectorAll(".copy-file-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var idx = Number(btn.getAttribute("data-idx"));
            var f = m.files[idx];
            if (f && navigator.clipboard) navigator.clipboard.writeText(f.content);
          });
        });
      }
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }

  function fillSelects() {
    var p = $("persona-select");
    var m = $("model-select");
    if (!window.ChatPartition) return;
    var st = window.ChatPartition.getState();
    if (p) {
      p.innerHTML = "";
      window.ChatPartition.PERSONAS.forEach(function (x) {
        var o = document.createElement("option");
        o.value = x.id;
        o.textContent = x.glyph + " " + x.name;
        if (x.id === st.personaId) o.selected = true;
        p.appendChild(o);
      });
      p.onchange = function () {
        window.ChatPartition.setPersona(p.value);
      };
    }
    if (m) {
      m.innerHTML = "";
      var ogC = document.createElement("optgroup");
      ogC.label = "Coding Pro (Free)";
      var ogG = document.createElement("optgroup");
      ogG.label = "General Chat & Reasoning (Free)";
      window.ChatPartition.FREE_MODELS.forEach(function (x) {
        var o = document.createElement("option");
        o.value = x.id;
        o.textContent = x.label;
        if (x.id === st.modelId) o.selected = true;
        (x.cat === "coding" ? ogC : ogG).appendChild(o);
      });
      m.appendChild(ogC);
      m.appendChild(ogG);
      m.onchange = function () {
        window.ChatPartition.setModel(m.value);
        try {
          localStorage.setItem("vcs-model", m.value);
        } catch (e) {}
      };
      try {
        var saved = localStorage.getItem("vcs-model");
        if (saved) {
          m.value = saved;
          window.ChatPartition.setModel(saved);
        }
      } catch (e) {}
    }
  }

  async function send() {
    if (streaming) return;
    var ta = $("composer");
    var text = (ta && ta.value || "").trim();
    if (!text) return;
    ta.value = "";
    streaming = true;
    if ($("send-btn")) $("send-btn").disabled = true;
    renderMessages();
    try {
      await window.ChatPartition.sendUserMessage(text, {
        onUpdate: function () {
          renderMessages();
        }
      });
    } catch (e) {}
    streaming = false;
    if ($("send-btn")) $("send-btn").disabled = false;
    renderMessages();
  }

  function paintHealth(snap) {
    var pill = $("hsys-pill");
    if (pill) {
      pill.textContent = "H " + Number(snap.hSys).toFixed(3);
      pill.dataset.threat = snap.threat || "";
    }
    if ($("drawer-hsys"))
      $("drawer-hsys").textContent =
        "H_sys " + Number(snap.hSys).toFixed(3) + " · " + (snap.threat || "");
    if ($("setting-hsys")) $("setting-hsys").textContent = Number(snap.hSys).toFixed(3);
    if ($("setting-threat")) $("setting-threat").textContent = snap.threat || "—";
  }

  function goWork(macroOrAegis) {
    showScreen("work");
    openDrawer(false);
    if (!window.WorkspaceRouter) return;
    var root = $("work-root");
    if (!root) return;
    // Temporarily point workspace router at work-root
    window.WorkspaceRouter.init(root);
    if (macroOrAegis === "aegis") {
      window.WorkspaceRouter.navigate({ type: "aegis" });
      if ($("screen-title")) $("screen-title").textContent = "NASE-AEGIS";
    } else {
      window.WorkspaceRouter.navigate({ type: "macro", id: macroOrAegis });
      if ($("screen-title"))
        $("screen-title").textContent =
          macroOrAegis.charAt(0).toUpperCase() + macroOrAegis.slice(1) + " Macro";
    }
  }

  function wire() {
    $("menu-btn").onclick = function () {
      openDrawer(true);
    };
    $("drawer-close").onclick = function () {
      openDrawer(false);
    };
    $("drawer-backdrop").onclick = function () {
      openDrawer(false);
    };

    document.querySelectorAll("[data-go]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var go = btn.getAttribute("data-go");
        if (go === "chat") {
          showScreen("chat");
          openDrawer(false);
          renderMessages();
        } else if (go === "settings") {
          showScreen("settings");
          openDrawer(false);
          refreshSettings();
        } else if (go === "aegis") {
          goWork("aegis");
        } else {
          goWork(go);
        }
      });
    });

    $("send-btn").onclick = send;
    $("composer").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    $("save-remote").onclick = function () {
      var v = ($("setting-remote").value || "").trim();
      try {
        localStorage.setItem("vcs-remote", v);
        localStorage.setItem("nnacc-v2-remote", v);
        window.__NNACC_REMOTE__ = v;
      } catch (e) {}
      $("save-remote").textContent = "Saved";
      setTimeout(function () {
        $("save-remote").textContent = "Save API URL";
      }, 1000);
    };

    $("btn-export-thread").onclick = function () {
      var json = window.ChatPartition.exportThread();
      if (navigator.clipboard) navigator.clipboard.writeText(json);
    };
    $("btn-delete-thread").onclick = function () {
      window.ChatPartition.deleteThread();
      renderMessages();
      showScreen("chat");
    };
    $("btn-force-probe").onclick = function () {
      if (window.NASE_Daemon) window.NASE_Daemon.probe().then(paintHealth);
    };

    window.addEventListener("nase:force-research", function () {
      goWork("research");
    });
  }

  function refreshSettings() {
    try {
      $("setting-remote").value =
        localStorage.getItem("vcs-remote") ||
        localStorage.getItem("nnacc-v2-remote") ||
        "https://nano-sandbox-api.onrender.com";
    } catch (e) {}
    if (window.NASE_Daemon) paintHealth(window.NASE_Daemon.getSnapshot());
    // vault
    var vel = $("setting-vault");
    try {
      var req = indexedDB.open("nnacc_vault_db");
      req.onsuccess = function () {
        if (vel) vel.textContent = "nnacc_vault_db connected";
        try {
          req.result.close();
        } catch (e) {}
      };
      req.onerror = function () {
        if (vel) vel.textContent = "unavailable";
      };
    } catch (e) {
      if (vel) vel.textContent = "error";
    }
  }

  function boot() {
    window.NASE_Daemon.init();
    window.NASE_Daemon.subscribe(paintHealth);
    paintHealth(window.NASE_Daemon.getSnapshot());
    fillSelects();
    wire();
    showScreen("chat");
    renderMessages();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
