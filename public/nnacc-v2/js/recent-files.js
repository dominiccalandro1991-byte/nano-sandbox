/**
 * Cross-thread recent files library (metadata only). Blobs stay in the vault.
 */
(function (global) {
  "use strict";
  var KEY = "vc_recent_files_v1";
  var CAP = 40;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
    } catch (e) {}
  }

  global.RecentFiles = {
    record: function (entry) {
      if (!entry || !entry.id) return;
      var list = read().filter(function (e) {
        return e.id !== entry.id;
      });
      list.unshift({
        id: entry.id,
        name: entry.name || "file",
        type: entry.type || "",
        size: entry.size || 0,
        ts: Date.now(),
        threadId: entry.threadId || null
      });
      write(list);
    },
    list: function () {
      return read();
    },
    clear: function () {
      write([]);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
