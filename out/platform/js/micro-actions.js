/**
 * Right Pane — context-aware micro-actions for active center route.
 */
(function (global) {
  "use strict";

  var root = null;

  function clear() {
    if (root) root.innerHTML = "<p class=\"muted small\">Select a workspace item.</p>";
  }

  function btn(label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "micro-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function render(route) {
    if (!root) return;
    root.innerHTML = "";
    var title = document.createElement("h2");
    title.textContent = "Micro-Actions";
    root.appendChild(title);

    if (!route || route.type === "empty") {
      clear();
      return;
    }

    if (route.type === "macro") {
      root.appendChild(
        btn("Export Data", function () {
          var out = document.getElementById("ws-macro-output");
          var text = out ? out.textContent : "";
          if (navigator.clipboard) navigator.clipboard.writeText(text);
        })
      );
      root.appendChild(
        btn("Force State Flush", function () {
          var meta = global.WorkspaceRouter.MACROS[route.id];
          if (meta) {
            meta.engines.forEach(function (id) {
              var iso = global.EngineIsolates.get(id);
              if (iso) iso.reset();
            });
          }
          global.WorkspaceRouter.navigate({ type: "macro", id: route.id });
        })
      );
      root.appendChild(
        btn("Re-run Probe", function () {
          if (global.NASE_Daemon) global.NASE_Daemon.probe();
        })
      );
    }

    if (route.type === "aegis") {
      root.appendChild(
        btn("Force State Flush", function () {
          if (global.NASE_Daemon) global.NASE_Daemon.probe();
          global.WorkspaceRouter.navigate({ type: "aegis" });
        })
      );
      root.appendChild(
        btn("Export Metrics", function () {
          var snap = global.NASE_Daemon.getSnapshot();
          if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
        })
      );
    }

    if (route.type === "chat") {
      root.appendChild(
        btn("Export Data", function () {
          var json = global.ChatPartition.exportThread();
          if (navigator.clipboard) navigator.clipboard.writeText(json);
        })
      );
      root.appendChild(
        btn("Delete Thread", function () {
          global.ChatPartition.deleteThread();
          global.WorkspaceRouter.navigate({ type: "chat" });
        })
      );
      root.appendChild(
        btn("Force State Flush", function () {
          global.WorkspaceRouter.navigate({ type: "chat" });
        })
      );
    }
  }

  global.MicroActions = {
    init: function (elRoot) {
      root = elRoot;
      clear();
      global.addEventListener("platform:route", function (ev) {
        render(ev.detail);
      });
    },
    render: render
  };
})(typeof window !== "undefined" ? window : globalThis);
