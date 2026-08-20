/**
 * History rail — App Store / Play-grade conversation list.
 * Beats ChatGPT/Claude/Gemini by searching every word, not just titles.
 */
(function (global) {
  "use strict";

  var filter = "all";
  var query = "";
  var hooks = {
    onSelect: function () {},
    onDelete: function () {},
    onRename: function () {},
    onPin: function () {}
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
  }

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function groupLabel(ts) {
    var now = Date.now();
    var today = startOfDay(now);
    var t = startOfDay(ts || now);
    var day = 86400000;
    if (t === today) return "Today";
    if (t === today - day) return "Yesterday";
    if (t > today - 7 * day) return "Previous 7 days";
    if (t > today - 30 * day) return "Previous 30 days";
    return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function relTime(ts) {
    if (!ts) return "";
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return "now";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    if (s < 604800) return Math.round(s / 86400) + "d";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function highlight(text, q) {
    var raw = String(text || "");
    if (!q) return escapeHtml(raw);
    var i = raw.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(raw);
    return (
      escapeHtml(raw.slice(0, i)) +
      "<mark>" +
      escapeHtml(raw.slice(i, i + q.length)) +
      "</mark>" +
      escapeHtml(raw.slice(i + q.length))
    );
  }

  function snippetAround(hay, q, fallback) {
    if (!q) return fallback || "";
    var h = String(hay || "");
    var i = h.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return fallback || "";
    var a = Math.max(0, i - 28);
    var b = Math.min(h.length, i + q.length + 42);
    return (a ? "…" : "") + h.slice(a, b) + (b < h.length ? "…" : "");
  }

  function matches(entry, q, f) {
    if (f === "pinned" && !entry.pinned) return false;
    if (f === "files" && !(entry.fileCount > 0)) return false;
    if (f === "engines" && !(entry.tools && entry.tools.length)) return false;
    if (!q) return true;
    var blob = (
      (entry.title || "") +
      " " +
      (entry.preview || "") +
      " " +
      (entry.haystack || "") +
      " " +
      (entry.tools || []).join(" ")
    ).toLowerCase();
    return blob.indexOf(q.toLowerCase()) >= 0;
  }

  function emptyCopy() {
    if (query) return { title: "No matches", sub: "Nothing in titles or full transcripts for “" + query + "”." };
    if (filter === "pinned") return { title: "Nothing pinned", sub: "Pin a thread to keep it at the top." };
    if (filter === "files") return { title: "No vaulted files", sub: "Drop a file on chat and it will show up here." };
    if (filter === "engines") return { title: "No engine runs yet", sub: "USSE, OIAV, and macros tag the thread automatically." };
    return { title: "No conversations yet", sub: "Hit + New Chat. Threads save on this device instantly." };
  }

  function render() {
    var root = $("session-history");
    var countEl = $("history-count");
    if (!root || !global.SessionEngine) return;
    var list = global.SessionEngine.listSessions() || [];
    var activeId =
      (global.NNACC_ACTIVE_SESSION_ID) ||
      global.SessionEngine.getActiveSessionId();
    if (countEl) countEl.textContent = String(list.length);
    var filtered = list.filter(function (e) {
      return matches(e, query, filter);
    });
    root.innerHTML = "";
    if (!filtered.length) {
      var empty = emptyCopy();
      var box = document.createElement("div");
      box.className = "history-empty";
      box.innerHTML = "<strong>" + escapeHtml(empty.title) + "</strong><p>" + escapeHtml(empty.sub) + "</p>";
      root.appendChild(box);
      return;
    }
    var lastGroup = null;
    filtered.forEach(function (entry) {
      var g = groupLabel(entry.updatedAt || entry.createdAt);
      if (g !== lastGroup) {
        lastGroup = g;
        var h = document.createElement("div");
        h.className = "history-group";
        h.textContent = g;
        root.appendChild(h);
      }
      var row = document.createElement("div");
      row.className = "session-item" + (entry.id === activeId ? " active" : "") + (entry.pinned ? " pinned" : "");
      row.setAttribute("role", "listitem");
      row.dataset.id = entry.id;

      var open = document.createElement("button");
      open.type = "button";
      open.className = "session-open";
      open.setAttribute("aria-label", "Open " + (entry.title || "chat"));
      var title = entry.title || "Untitled chat";
      var preview = query
        ? snippetAround(entry.haystack || entry.preview || title, query, entry.preview)
        : entry.preview || "No messages yet";
      var tools = (entry.tools || []).slice(0, 3)
        .map(function (t) {
          return '<span class="hist-chip">' + escapeHtml(t.replace(/-.*$/, "")) + "</span>";
        })
        .join("");
      open.innerHTML =
        '<span class="session-title">' +
        (entry.pinned ? "📌 " : "") +
        highlight(title, query) +
        '</span><span class="session-preview">' +
        highlight(preview, query) +
        '</span><span class="session-meta-row"><span class="session-time">' +
        escapeHtml(relTime(entry.updatedAt)) +
        "</span>" +
        (entry.fileCount ? '<span class="hist-chip">📎' + entry.fileCount + "</span>" : "") +
        tools +
        '<span class="session-meta">' +
        (entry.messageCount || 0) +
        "</span></span>";
      open.addEventListener("click", function () {
        hooks.onSelect(entry.id);
      });

      var trail = document.createElement("div");
      trail.className = "session-trail";

      var pin = document.createElement("button");
      pin.type = "button";
      pin.className = "session-icon-btn";
      pin.title = entry.pinned ? "Unpin" : "Pin";
      pin.setAttribute("aria-label", pin.title);
      pin.textContent = entry.pinned ? "📌" : "☆";
      pin.addEventListener("click", function (ev) {
        ev.stopPropagation();
        hooks.onPin(entry.id, !entry.pinned);
      });

      var rename = document.createElement("button");
      rename.type = "button";
      rename.className = "session-icon-btn";
      rename.title = "Rename";
      rename.setAttribute("aria-label", "Rename conversation");
      rename.textContent = "✎";
      rename.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var next = window.prompt("Rename conversation", entry.title || "");
        if (next && next.trim()) hooks.onRename(entry.id, next.trim());
      });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "session-icon-btn danger";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete conversation");
      del.textContent = "✕";
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (row.classList.contains("confirm-delete")) {
          hooks.onDelete(entry.id);
          return;
        }
        row.classList.add("confirm-delete");
        del.textContent = "Delete";
        del.classList.add("confirm");
        setTimeout(function () {
          row.classList.remove("confirm-delete");
          del.textContent = "✕";
          del.classList.remove("confirm");
        }, 2800);
      });

      trail.appendChild(pin);
      trail.appendChild(rename);
      trail.appendChild(del);
      row.appendChild(open);
      row.appendChild(trail);
      root.appendChild(row);
    });
  }

  function wire() {
    var search = $("history-search");
    if (search && !search.dataset.wired) {
      search.dataset.wired = "1";
      search.addEventListener("input", function () {
        query = search.value.trim();
        render();
      });
      search.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          search.value = "";
          query = "";
          render();
          search.blur();
        }
      });
    }
    document.querySelectorAll(".hist-filter").forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function () {
        filter = btn.getAttribute("data-filter") || "all";
        document.querySelectorAll(".hist-filter").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        render();
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "")) {
        var s = $("history-search");
        if (!s) return;
        e.preventDefault();
        s.focus();
      }
    });
  }

  global.HistoryRail = {
    init: function (opts) {
      hooks = Object.assign(hooks, opts || {});
      wire();
      render();
    },
    refresh: render,
    setActiveId: function (id) {
      global.NNACC_ACTIVE_SESSION_ID = id;
      render();
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
