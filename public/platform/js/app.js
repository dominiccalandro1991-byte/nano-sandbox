/**
 * App entry — enforced mount sequence from SYSTEM_RESTRUCTURE.md
 * 1. NASE_Daemon
 * 2. Sidebar navigation tree
 * 3. Vault connector (client-state)
 * 4. Await user selection → WorkspaceRouter mounts components
 *
 * Layout: Left suites | Center workspace | Right micro-actions
 * Note: Modular vanilla isolates mirror React useState isolation without
 * requiring an npm build (Pages deploy remains static).
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function wireNav() {
    document.querySelectorAll("[data-route]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("[data-route]").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        var raw = btn.getAttribute("data-route");
        var route = JSON.parse(raw);
        window.WorkspaceRouter.navigate(route);
      });
    });

    document.querySelectorAll("[data-suite-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-suite-toggle");
        var body = document.querySelector('[data-suite-body="' + id + '"]');
        if (body) body.classList.toggle("collapsed");
        btn.classList.toggle("open");
      });
    });
  }

  function mountVaultConnector() {
    // Client-state mock / status for nnacc_vault_db (IndexedDB presence check)
    var el = $("vault-connector-status");
    if (!el) return;
    try {
      if (!window.indexedDB) {
        el.textContent = "Vault: IndexedDB unavailable";
        el.dataset.state = "error";
        return;
      }
      var req = indexedDB.open("nnacc_vault_db");
      req.onerror = function () {
        el.textContent = "Vault: open failed";
        el.dataset.state = "error";
      };
      req.onsuccess = function () {
        el.textContent = "Vault: nnacc_vault_db connected";
        el.dataset.state = "ok";
        try {
          req.result.close();
        } catch (e) {}
      };
    } catch (e) {
      el.textContent = "Vault: " + (e.message || "error");
      el.dataset.state = "error";
    }
  }

  function paintHsys(snap) {
    var el = $("global-hsys");
    var th = $("global-threat");
    if (el) el.textContent = Number(snap.hSys).toFixed(3);
    if (th) {
      th.textContent = snap.threat;
      th.dataset.threat = snap.threat;
    }
  }

  function boot() {
    // 1. Initialize NASE_Daemon
    window.NASE_Daemon.init();
    window.NASE_Daemon.subscribe(paintHsys);
    paintHsys(window.NASE_Daemon.getSnapshot());

    // 2. Mount Sidebar Navigation tree (already in DOM; wire events)
    wireNav();

    // 3. Mount persistent vault database connector
    mountVaultConnector();

    // 4. Workspace + micro-actions await user selection
    window.WorkspaceRouter.init($("center-workspace"));
    window.MicroActions.init($("right-micro"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
