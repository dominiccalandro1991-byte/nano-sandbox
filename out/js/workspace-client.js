/**
 * Projects / archive / remote search. Falls back to localStorage if API is down.
 */
(function (global) {
  "use strict";
  var PKEY = "vc_projects_v1";
  var cache = { projects: [] };

  function remote() {
    try {
      if (global.__NNACC_REMOTE__ && /^https?:\/\//i.test(global.__NNACC_REMOTE__)) {
        return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      }
      var s = localStorage.getItem("nnacc-v2-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return "https://nano-sandbox-api.onrender.com";
  }
  function localProjects() {
    try {
      var raw = localStorage.getItem(PKEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function saveLocal(list) {
    try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch (e) {}
    cache.projects = list;
  }

  function upsertThread(session, indexEntry) {
    if (!session || session.temporary) return;
    var e = indexEntry || {};
    var body = {
      id: session.id,
      title: session.title || e.title,
      preview: e.preview || "",
      haystack: e.haystack || "",
      archived: !!session.archived,
      pinned: !!session.pinned,
      project_id: session.projectId || null,
      updated_at: session.updatedAt,
      created_at: session.createdAt
    };
    fetch(remote() + "/workspace/threads", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).catch(function () {});
  }

  global.Workspace = {
    projects: function () { return cache.projects.length ? cache.projects : localProjects(); },
    refreshProjects: function () {
      return fetch(remote() + "/workspace/projects", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          cache.projects = d.projects || [];
          saveLocal(cache.projects);
          return cache.projects;
        })
        .catch(function () {
          cache.projects = localProjects();
          return cache.projects;
        });
    },
    createProject: function (name) {
      return fetch(remote() + "/workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: name })
      })
        .then(function (r) { return r.json(); })
        .then(function (p) {
          var list = localProjects();
          list.unshift(p);
          saveLocal(list);
          return p;
        })
        .catch(function () {
          var p = { id: "local_" + Date.now(), name: name, created_at: Date.now() / 1000 };
          var list = localProjects();
          list.unshift(p);
          saveLocal(list);
          return p;
        });
    },
    searchRemote: function (q, archived) {
      var url = remote() + "/workspace/threads/search?q=" + encodeURIComponent(q || "");
      if (archived === true) url += "&archived=true";
      if (archived === false) url += "&archived=false";
      return fetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { results: [] }; })
        .then(function (d) { return d.results || []; })
        .catch(function () { return []; });
    },
    upsertThread: upsertThread,
    patchThread: function (id, body) {
      return fetch(remote() + "/workspace/threads/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      }).catch(function () {});
    },
    deleteThread: function (id) {
      return fetch(remote() + "/workspace/threads/" + encodeURIComponent(id), { method: "DELETE" }).catch(function () {});
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
