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
  function run() {
    var status = $("keyharbor-status");
    var log = $("keyharbor-log");
    if (status) status.textContent = "Loading…";
    Promise.all([
      fetch(remote() + "/keyharbor/health").then(function (r) { return r.json(); }),
      fetch(remote() + "/keyharbor/audit?limit=12").then(function (r) { return r.json(); })
    ])
      .then(function (pair) {
        if (status) status.textContent = pair[0].ok ? "Online" : "Down";
        if (log) { log.hidden = false; log.textContent = JSON.stringify({ health: pair[0], audit: pair[1] }, null, 2); }
      })
      .catch(function (err) {
        if (status) status.textContent = "Unreachable";
        if (log) { log.hidden = false; log.textContent = String(err && err.message ? err.message : err); }
      });
  }
  function wire() {
    var btn = $("keyharbor-run");
    if (btn) btn.addEventListener("click", run);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})(typeof window !== "undefined" ? window : globalThis);
