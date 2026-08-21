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
    var status = $("proofpatch-status");
    var log = $("proofpatch-log");
    var diff = ($("proofpatch-diff") || {}).value || "";
    if (status) status.textContent = "Running isolated verify…";
    if (log) { log.hidden = false; log.textContent = ""; }
    fetch(remote() + "/proofpatch/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        repo: "dominiccalandro1991-byte/nano-sandbox",
        base: "main",
        patch: diff.trim() || null
      })
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      })
      .then(function (x) {
        var body = x.j.detail || x.j;
        if (status) status.textContent = x.ok && body.ok ? "Passed" : "Failed";
        if (log) log.textContent = JSON.stringify(body, null, 2);
      })
      .catch(function (err) {
        if (status) status.textContent = "Unreachable";
        if (log) log.textContent = String(err && err.message ? err.message : err);
      });
  }
  function wire() {
    var btn = $("proofpatch-run");
    if (btn) btn.addEventListener("click", run);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})(typeof window !== "undefined" ? window : globalThis);
