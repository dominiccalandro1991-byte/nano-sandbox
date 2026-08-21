(function (global) {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function isMod(e) { return e.metaKey || e.ctrlKey; }
  function inField(e) {
    var t = (e.target && e.target.tagName) || "";
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
  }
  function closeModals() {
    ["settings-modal", "share-modal", "account-modal", "shortcuts-modal", "file-preview-modal"].forEach(function (id) {
      var m = $(id);
      if (m) m.hidden = true;
    });
  }
  function openShortcuts() {
    var m = $("shortcuts-modal");
    if (m) m.hidden = false;
  }
  function wire() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeModals();
        return;
      }
      if (isMod(e) && e.key === "k") {
        e.preventDefault();
        var ta = $("composer-input");
        if (ta) ta.focus();
        return;
      }
      if (isMod(e) && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        var nc = $("new-chat-btn");
        if (nc) nc.click();
        return;
      }
      if (isMod(e) && e.shiftKey && e.key === ";") {
        e.preventDefault();
        if (global.ChatScreen) global.ChatScreen.startTemporary();
        return;
      }
      if (isMod(e) && e.key === "/") {
        e.preventDefault();
        openShortcuts();
        return;
      }
      if (e.key === "/" && !inField(e)) {
        var s = $("history-search");
        if (s) {
          e.preventDefault();
          s.focus();
        }
      }
    });
    var close = $("close-shortcuts");
    if (close) close.addEventListener("click", function () {
      var m = $("shortcuts-modal");
      if (m) m.hidden = true;
    });
  }
  global.Shortcuts = { init: wire, open: openShortcuts };
})(typeof window !== "undefined" ? window : globalThis);
