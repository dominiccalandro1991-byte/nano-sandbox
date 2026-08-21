/**
 * Account, encrypted API key, traits array, memory. Syncs to /auth when signed in.
 */
(function (global) {
  "use strict";
  var TKEY = "vc-token";
  var UKEY = "vc-user";
  var SKEY = "vc-user-settings";
  var KKEY = "vc-api-key-enc";

  function $(id) { return document.getElementById(id); }
  function remote() {
    try {
      if (global.__NNACC_REMOTE__) return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      var s = localStorage.getItem("nnacc-v2-remote") || "";
      if (s) return s.replace(/\/$/, "");
    } catch (e) {}
    return "https://nano-sandbox-api.onrender.com";
  }
  function toast(m) {
    if (global.NNACC && global.NNACC.showToast) global.NNACC.showToast(m);
  }
  function readSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SKEY) || "{}");
      if (!s.traits) s.traits = [];
      if (!s.memory) s.memory = [];
      if (!s.instructions) s.instructions = "";
      return s;
    } catch (e) {
      return { traits: [], memory: [], instructions: "" };
    }
  }
  function writeSettings(s) {
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {}
  }
  function token() {
    try { return localStorage.getItem(TKEY) || ""; } catch (e) { return ""; }
  }
  function user() {
    try { return JSON.parse(localStorage.getItem(UKEY) || "null"); } catch (e) { return null; }
  }
  function setSession(u, tok) {
    try {
      if (u) localStorage.setItem(UKEY, JSON.stringify(u));
      else localStorage.removeItem(UKEY);
      if (tok) localStorage.setItem(TKEY, tok);
      else localStorage.removeItem(TKEY);
    } catch (e) {}
    paintRail();
  }
  function headers(json) {
    var h = { Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    var t = token();
    if (t) h.Authorization = "Bearer " + t;
    var k = getApiKey();
    if (k) h["X-User-OpenRouter-Key"] = k;
    return h;
  }
  function xorEnc(plain) {
    var s = "vc-device-wrap-v1";
    var out = [];
    for (var i = 0; i < plain.length; i++) out.push((plain.charCodeAt(i) ^ s.charCodeAt(i % s.length)).toString(16).padStart(2, "0"));
    return out.join("");
  }
  function xorDec(hex) {
    if (!hex) return "";
    var s = "vc-device-wrap-v1";
    var out = "";
    for (var i = 0; i < hex.length; i += 2) {
      var c = parseInt(hex.slice(i, i + 2), 16);
      if (isNaN(c)) return "";
      out += String.fromCharCode(c ^ s.charCodeAt((i / 2) % s.length));
    }
    return out;
  }
  function getApiKey() {
    try { return xorDec(localStorage.getItem(KKEY) || ""); } catch (e) { return ""; }
  }
  function setApiKey(plain) {
    try {
      if (plain) localStorage.setItem(KKEY, xorEnc(plain));
      else localStorage.removeItem(KKEY);
    } catch (e) {}
  }
  function paintRail() {
    var u = user();
    var btn = $("account-rail-btn");
    var label = $("account-rail-label");
    var name = $("setting-account-status");
    if (btn) {
      btn.title = u ? (u.display_name || u.email) : "Sign in";
      var av = btn.querySelector(".account-av");
      if (av) av.textContent = u ? String(u.display_name || u.email || "U").charAt(0).toUpperCase() : "?";
    }
    if (label) label.textContent = u ? (u.display_name || u.email) : "Sign in";
    if (name) name.textContent = u ? ("Signed in as " + (u.display_name || u.email)) : "Signed out — chats stay on this device until you sign in.";
    var lo = $("logout-btn");
    if (lo) lo.hidden = !u;
  }
  function paintTraits() {
    var traits = readSettings().traits || [];
    document.querySelectorAll(".trait-chip").forEach(function (c) {
      c.classList.toggle("on", traits.indexOf(c.getAttribute("data-trait")) >= 0);
    });
  }
  function paintMemory() {
    var box = $("memory-list");
    if (!box) return;
    var mem = readSettings().memory || [];
    box.innerHTML = "";
    if (!mem.length) {
      box.innerHTML = '<p class="muted small">No memories yet.</p>';
      return;
    }
    mem.forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "memory-row";
      row.innerHTML = "<span></span>";
      row.querySelector("span").textContent = m;
      var del = document.createElement("button");
      del.type = "button";
      del.className = "ghost-btn";
      del.textContent = "Remove";
      del.addEventListener("click", function () {
        var s = readSettings();
        s.memory = (s.memory || []).filter(function (_, j) { return j !== i; });
        writeSettings(s);
        syncRemote(s);
        paintMemory();
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function syncRemote(s) {
    if (!token()) return;
    var body = {
      traits: s.traits,
      memory: s.memory,
      instructions: s.instructions
    };
    var key = getApiKey();
    if (key) body.api_key = key;
    fetch(remote() + "/auth/me/settings", {
      method: "PUT",
      headers: headers(true),
      body: JSON.stringify(body)
    }).catch(function () {});
  }
  function systemBits() {
    var s = readSettings();
    var bits = [];
    if (s.traits && s.traits.length) bits.push("Response traits: " + s.traits.join(", ") + ".");
    if (s.memory && s.memory.length) bits.push("Memory about the user:\n- " + s.memory.join("\n- "));
    if (s.instructions) bits.push("Custom instructions: " + s.instructions);
    var u = user();
    if (u && u.display_name) bits.push("The user's name is " + u.display_name + ".");
    return bits.join("\n");
  }
  function auth(path, body) {
    return fetch(remote() + "/auth/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j, status: r.status }; });
    });
  }
  function afterAuth(x) {
    if (!x.ok) {
      toast((x.j && x.j.detail) || ("Auth failed " + x.status));
      return;
    }
    setSession(x.j.user, x.j.token);
    fetch(remote() + "/auth/me", { headers: headers() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.settings) {
          var s = readSettings();
          s.traits = d.settings.traits || s.traits;
          s.memory = d.settings.memory || s.memory;
          s.instructions = d.settings.instructions || s.instructions;
          writeSettings(s);
          paintTraits();
          paintMemory();
          if ($("setting-instructions")) $("setting-instructions").value = s.instructions || "";
        }
        var modal = $("account-modal");
        if (modal) modal.hidden = true;
        toast("Signed in");
      })
      .catch(function () {
        var modal = $("account-modal");
        if (modal) modal.hidden = true;
        toast("Signed in (offline settings)");
      });
  }
  function wire() {
    paintRail();
    paintTraits();
    paintMemory();
    var s = readSettings();
    if ($("setting-instructions") && s.instructions) $("setting-instructions").value = s.instructions;
    if ($("setting-api-key") && getApiKey()) $("setting-api-key").placeholder = "Key saved on this device";
    document.querySelectorAll(".trait-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var t = chip.getAttribute("data-trait");
        var st = readSettings();
        st.traits = st.traits || [];
        if (st.traits.indexOf(t) >= 0) st.traits = st.traits.filter(function (x) { return x !== t; });
        else st.traits.push(t);
        writeSettings(st);
        paintTraits();
        syncRemote(st);
      });
    });
    var addMem = $("add-memory-btn");
    if (addMem) addMem.addEventListener("click", function () {
      var inp = $("setting-memory");
      var text = inp && inp.value.trim();
      if (!text) return;
      var st = readSettings();
      st.memory = st.memory || [];
      st.memory.unshift(text);
      writeSettings(st);
      if (inp) inp.value = "";
      paintMemory();
      syncRemote(st);
    });
    var saveKey = $("save-api-key-btn");
    if (saveKey) saveKey.addEventListener("click", function () {
      var inp = $("setting-api-key");
      var v = inp && inp.value.trim();
      if (v) {
        setApiKey(v);
        if (inp) inp.value = "";
        toast("API key stored encrypted on this device");
      }
      var st = readSettings();
      if (v) st.api_key = v;
      syncRemote(st);
      var stEl = $("api-key-status");
      if (stEl) stEl.textContent = getApiKey() ? "Saved on this device" : "Not set";
    });
    var clearKey = $("clear-api-key-btn");
    if (clearKey) clearKey.addEventListener("click", function () {
      setApiKey("");
      if (token()) {
        fetch(remote() + "/auth/me/settings", {
          method: "PUT",
          headers: headers(true),
          body: JSON.stringify({ clear_api_key: true })
        }).catch(function () {});
      }
      toast("API key cleared");
      var stEl = $("api-key-status");
      if (stEl) stEl.textContent = "Not set";
    });
    var openAcc = $("account-rail-btn");
    if (openAcc) openAcc.addEventListener("click", function () {
      if (user()) {
        var sm = $("settings-modal");
        if (sm) sm.hidden = false;
        document.querySelectorAll(".set-tab").forEach(function (t) {
          t.classList.toggle("on", t.getAttribute("data-set") === "account");
        });
        document.querySelectorAll(".set-pane").forEach(function (p) {
          p.classList.toggle("on", p.getAttribute("data-pane") === "account");
        });
        return;
      }
      var m = $("account-modal");
      if (m) m.hidden = false;
    });
    var closeAcc = $("close-account");
    if (closeAcc) closeAcc.addEventListener("click", function () {
      var m = $("account-modal");
      if (m) m.hidden = true;
    });
    var login = $("account-login-btn");
    if (login) login.addEventListener("click", function () {
      auth("login", { email: ($("account-email") || {}).value, password: ($("account-password") || {}).value }).then(afterAuth);
    });
    var reg = $("account-register-btn");
    if (reg) reg.addEventListener("click", function () {
      auth("register", {
        email: ($("account-email") || {}).value,
        password: ($("account-password") || {}).value,
        display_name: ($("account-name") || {}).value || ""
      }).then(afterAuth);
    });
    var lo = $("logout-btn");
    if (lo) lo.addEventListener("click", function () {
      setSession(null, null);
      toast("Signed out");
    });
    var saveSet = $("save-settings");
    if (saveSet) saveSet.addEventListener("click", function () {
      var st = readSettings();
      if ($("setting-instructions")) st.instructions = $("setting-instructions").value;
      writeSettings(st);
      syncRemote(st);
    });
  }

  global.Account = {
    init: wire,
    headers: headers,
    getApiKey: getApiKey,
    systemBits: systemBits,
    user: user,
    token: token
  };
})(typeof window !== "undefined" ? window : globalThis);
