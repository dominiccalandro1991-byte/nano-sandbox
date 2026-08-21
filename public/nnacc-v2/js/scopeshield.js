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
    var status = $("scopeshield-status");
    var log = $("scopeshield-log");
    if (status) status.textContent = "Checking…";
    fetch(remote() + "/scopeshield/preflight?profile=nano-sandbox", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        var body = x.j.detail || x.j;
        if (status) status.textContent = body.ok ? "Pass" : "Fail";
        if (log) { log.hidden = false; log.textContent = JSON.stringify(body, null, 2); }
      })
      .catch(function (err) {
        if (status) status.textContent = "Unreachable";
        if (log) { log.hidden = false; log.textContent = String(err && err.message ? err.message : err); }
      });
  }
  function wire() {
    var btn = $("scopeshield-run");
    if (btn) btn.addEventListener("click", run);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})(typeof window !== "undefined" ? window : globalThis);
