(function (global) {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function remote() {
    try {
      if (global.__NNACC_REMOTE__) return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      var s = localStorage.getItem("nnacc-v2-remote") || "";
      if (s) return s.replace(/\/$/, "");
    } catch (e) {}
    return "https://nano-sandbox-api.onrender.com";
  }
  function paint(status, log, payload) {
    if (status) status.textContent = payload.hit ? "Hit · patch recalled" : (payload.ok ? "Stored" : (payload.error || "Idle"));
    if (log) { log.hidden = false; log.textContent = JSON.stringify(payload, null, 2); }
  }
  function query() {
    var status = $("incidentdojo-status");
    var log = $("incidentdojo-log");
    var stack = ($("incidentdojo-stack") || {}).value || "";
    if (status) status.textContent = "Querying…";
    fetch(remote() + "/incidentdojo/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ error_stack: stack, threshold: 0.05 })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { paint(status, log, x.j.detail || x.j); })
      .catch(function (err) { paint(status, log, { error: String(err && err.message ? err.message : err) }); });
  }
  function list() {
    var log = $("incidentdojo-log");
    fetch(remote() + "/incidentdojo/incidents?limit=12", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (log) { log.hidden = false; log.textContent = JSON.stringify(j, null, 2); } })
      .catch(function () {});
  }
  function wire() {
    var q = $("incidentdojo-query");
    var l = $("incidentdojo-list");
    if (q) q.addEventListener("click", query);
    if (l) l.addEventListener("click", list);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})(typeof window !== "undefined" ? window : globalThis);
