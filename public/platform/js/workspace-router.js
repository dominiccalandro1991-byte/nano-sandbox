/**
 * Center Pane Workspace Router — mounts one suite view at a time (no overlap).
 */
(function (global) {
  "use strict";

  var MACROS = {
    research: {
      id: "research",
      title: "Research Macro",
      suite: "engines",
      engines: [1, 2, 3, 4, 5],
      fields: [
        { key: "query", label: "Query", type: "text" },
        { key: "sources", label: "Sources", type: "text" }
      ]
    },
    inventor: {
      id: "inventor",
      title: "Inventor Macro",
      suite: "engines",
      engines: [6, 7, 8, 9, 10],
      fields: [
        { key: "concept", label: "Concept", type: "text" },
        { key: "utility_mass_lb", label: "Utility mass (lb)", type: "number", value: "400" }
      ]
    },
    coder: {
      id: "coder",
      title: "Coder Macro",
      suite: "engines",
      engines: [11, 12, 13, 14, 15],
      fields: [
        { key: "task", label: "Task", type: "text" }
      ],
      languageMulti: true
    },
    deploy: {
      id: "deploy",
      title: "Deploy Macro",
      suite: "engines",
      engines: [16, 17, 18, 19, 20],
      fields: [
        { key: "target", label: "Target", type: "text", value: "github-pages" },
        { key: "app_name", label: "App name", type: "text", value: "nano-sandbox" }
      ]
    }
  };

  var activeRoute = null;
  var root = null;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }


  var LANGUAGE_CATALOG = [
    "Assembly","Ada","APL","Arduino","ASP.NET","AWK","Bash","Batch","C","C#","C++","Carbon","Clojure","COBOL","CoffeeScript","Common Lisp","Crystal","CSS","CUDA","D","Dart","Delphi","Dockerfile","Elixir","Elm","Erlang","F#","Fortran","GDScript","Go","GraphQL","Groovy","Haskell","Haxe","HTML","Java","JavaScript","Julia","Kotlin","LaTeX","Lean","Less","Lisp","Lua","Makefile","MATLAB","Nim","Nix","Objective-C","OCaml","Pascal","Perl","PHP","PL/SQL","PowerShell","Prisma","Protobuf","Python","R","Racket","Raku","Reason","Ruby","Rust","SAS","Scala","Scheme","SCSS","Shell","Smalltalk","Solidity","SQL","Svelte","Swift","Tcl","TOML","TypeScript","V","Vala","VB.NET","Verilog","VHDL","Vue","WebAssembly","XML","YAML","Zig"
  ];

  function readFilesAsPayload(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    return Promise.all(
      files.map(function (file) {
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () {
            var result = reader.result;
            var isText = typeof result === "string";
            resolve({
              name: file.name,
              size: file.size,
              type: file.type || "application/octet-stream",
              lastModified: file.lastModified,
              encoding: isText ? "utf8" : "base64",
              content: isText
                ? result
                : (result && result.split && result.indexOf(",") >= 0
                    ? result.split(",")[1]
                    : result)
            });
          };
          reader.onerror = function () {
            resolve({
              name: file.name,
              size: file.size,
              type: file.type || "application/octet-stream",
              error: "read_failed"
            });
          };
          // Prefer text for code-like types; otherwise data URL base64
          if (
            /^(text\/|application\/(json|javascript|xml|x-yaml|toml)|.*\+(json|xml))/i.test(
              file.type
            ) ||
            /\.(txt|md|json|js|jsx|ts|tsx|py|go|rs|java|c|cpp|h|hpp|css|scss|html|htm|xml|yml|yaml|toml|sh|sql|vue|svelte|rb|php|swift|kt|cs|r|lua)$/i.test(
              file.name
            )
          ) {
            reader.readAsText(file);
          } else {
            reader.readAsDataURL(file);
          }
        });
      })
    );
  }

  function buildIngestZone(panel) {
    var zone = el("div", "ingest-zone");
    zone.innerHTML =
      '<div class="ingest-label">Universal payload ingestion</div>' +
      '<div class="ingest-drop" tabindex="0">' +
      "<span>Drop files here or click to upload</span>" +
      '<input type="file" multiple accept="*/*" class="ingest-input" />' +
      "</div>" +
      '<ul class="ingest-file-list"></ul>';
    var drop = zone.querySelector(".ingest-drop");
    var input = zone.querySelector(".ingest-input");
    var list = zone.querySelector(".ingest-file-list");
    panel._ingestFiles = [];

    function renderList() {
      list.innerHTML = "";
      panel._ingestFiles.forEach(function (f, idx) {
        var li = document.createElement("li");
        li.textContent = f.name + " (" + f.size + " B)";
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "ingest-remove";
        rm.textContent = "✕";
        rm.addEventListener("click", function () {
          panel._ingestFiles.splice(idx, 1);
          renderList();
        });
        li.appendChild(rm);
        list.appendChild(li);
      });
    }

    async function addFileList(fileList) {
      var parsed = await readFilesAsPayload(fileList);
      panel._ingestFiles = panel._ingestFiles.concat(parsed);
      renderList();
    }

    drop.addEventListener("click", function () {
      input.click();
    });
    input.addEventListener("change", function () {
      if (input.files && input.files.length) addFileList(input.files);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.remove("dragover");
      });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFileList(e.dataTransfer.files);
    });
    return zone;
  }

  function buildLanguageMultiSelect(form) {
    var wrap = el("div", "lang-multi");
    wrap.innerHTML =
      '<label class="ws-field"><span>Languages (search · multi-select)</span>' +
      '<input type="search" class="lang-search" placeholder="Search languages…" autocomplete="off" />' +
      "</label>" +
      '<div class="lang-selected"></div>' +
      '<div class="lang-options" role="listbox"></div>';
    var search = wrap.querySelector(".lang-search");
    var opts = wrap.querySelector(".lang-options");
    var selectedEl = wrap.querySelector(".lang-selected");
    var selected = ["TypeScript"];

    function paintSelected() {
      selectedEl.innerHTML = "";
      selected.forEach(function (lang) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "lang-chip";
        chip.textContent = lang + " ✕";
        chip.addEventListener("click", function () {
          selected = selected.filter(function (x) {
            return x !== lang;
          });
          paintSelected();
          paintOptions(search.value);
        });
        selectedEl.appendChild(chip);
      });
      form._languages = selected.slice();
    }

    function paintOptions(q) {
      q = String(q || "")
        .trim()
        .toLowerCase();
      opts.innerHTML = "";
      LANGUAGE_CATALOG.filter(function (lang) {
        return !q || lang.toLowerCase().indexOf(q) !== -1;
      }).forEach(function (lang) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "lang-option" + (selected.indexOf(lang) >= 0 ? " is-selected" : "");
        btn.textContent = lang;
        btn.addEventListener("click", function () {
          if (selected.indexOf(lang) >= 0) {
            selected = selected.filter(function (x) {
              return x !== lang;
            });
          } else {
            selected.push(lang);
          }
          paintSelected();
          paintOptions(search.value);
        });
        opts.appendChild(btn);
      });
    }

    search.addEventListener("input", function () {
      paintOptions(search.value);
    });
    paintSelected();
    paintOptions("");
    form.appendChild(wrap);
    form._languages = selected.slice();
  }


  function mountMacro(macroId, opts) {
    opts = opts || {};
    var meta = MACROS[macroId];
    if (!meta || !root) return;
    activeRoute = { type: "macro", id: macroId };
    root.innerHTML = "";
    var panel = el("div", "ws-panel");
    var head = el("header", "ws-head");
    head.innerHTML =
      "<h1>" +
      meta.title +
      "</h1><p class=\"muted\">φ" +
      meta.engines[0] +
      "–φ" +
      meta.engines[meta.engines.length - 1] +
      " · isolated engine bags</p>";
    if (opts.forcedRepair) {
      var ban = el(
        "div",
        "ws-banner warn",
        "H_sys below 0.85 — Research diagnostic forced. Execute Autonomous Repair."
      );
      panel.appendChild(ban);
    }
    panel.appendChild(head);

    var chips = el("div", "ws-chip-row");
    meta.engines.forEach(function (id) {
      var iso = global.EngineIsolates.get(id);
      var snap = iso ? iso.getState() : { name: "e" + id, status: "?" };
      var c = el(
        "span",
        "ws-chip status-" + snap.status,
        "φ" + id + " " + snap.name + " · " + snap.status
      );
      chips.appendChild(c);
    });
    panel.appendChild(chips);

    var form = el("div", "ws-form");
    panel.appendChild(buildIngestZone(panel));
    meta.fields.forEach(function (f) {
      if (f.key === "language") return; // deprecated string language field
      var lab = el("label", "ws-field");
      lab.innerHTML = "<span>" + f.label + "</span>";
      var input = document.createElement("input");
      input.type = f.type || "text";
      input.dataset.key = f.key;
      if (f.value) input.value = f.value;
      lab.appendChild(input);
      form.appendChild(lab);
    });
    if (meta.languageMulti || macroId === "coder") {
      buildLanguageMultiSelect(form);
    }
    var run = el("button", "ws-primary-btn", opts.forcedRepair ? "Execute Autonomous Repair" : "Run Macro");
    run.type = "button";
    run.addEventListener("click", function () {
      executeMacro(macroId, form, run);
    });
    form.appendChild(run);
    panel.appendChild(form);

    var out = el("pre", "ws-output", "Ready.");
    out.id = "ws-macro-output";
    panel.appendChild(out);
    root.appendChild(panel);
    try {
      global.dispatchEvent(new CustomEvent("platform:route", { detail: activeRoute }));
    } catch (e) {}
  }

  async function executeMacro(macroId, form, btn) {
    var payload = {};
    form.querySelectorAll("[data-key]").forEach(function (input) {
      var k = input.dataset.key;
      if (k === "language") return;
      var v = input.value;
      if (input.type === "number") {
        if (v === "") return;
        payload[k] = Number(v);
      } else if (v !== "") payload[k] = v;
    });
    // Language taxonomy: singular string or multi-stack array
    var langs = (form._languages || []).slice();
    if (langs.length === 1) {
      payload.language = langs[0];
      payload.languages = langs;
    } else if (langs.length > 1) {
      payload.languages = langs;
      payload.language = langs.join(",");
    }
    // Universal file ingestion bound to active engine payload
    var panel = root && root.querySelector(".ws-panel");
    var ingested = (panel && panel._ingestFiles) || [];
    if (ingested.length) {
      payload.attachments = ingested;
      payload.files = ingested.map(function (f) {
        return { name: f.name, size: f.size, type: f.type, encoding: f.encoding };
      });
    }
    var meta = MACROS[macroId];
    meta.engines.forEach(function (id) {
      var iso = global.EngineIsolates.get(id);
      if (iso) iso.setInput(payload);
    });
    btn.disabled = true;
    var out = document.getElementById("ws-macro-output");
    if (out) out.textContent = "Running…";
    var base =
      (global.NASE_Daemon && global.NASE_Daemon.backendBase()) ||
      "https://nano-sandbox-api.onrender.com";
    try {
      var res = await fetch(base + "/nase/macro/" + encodeURIComponent(macroId), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ payload: payload })
      });
      var body = await res.json();
      meta.engines.forEach(function (id) {
        var iso = global.EngineIsolates.get(id);
        if (iso) {
          if (res.ok) iso.setOutput(body);
          else iso.setError("HTTP " + res.status);
        }
      });
      var textOut = JSON.stringify(body, null, 2);
      if (out) {
        out.textContent = textOut;
        out.classList.add("ws-output-expanded");
      }
      // O(1) repaint: re-mount same route to refresh chips
      mountMacro(macroId, {});
      var out2 = document.getElementById("ws-macro-output");
      if (out2) {
        out2.textContent = textOut;
        out2.classList.add("ws-output-expanded");
        var blob = textOut;
        if (body && (body.content || body.result)) {
          blob = String(body.content || body.result);
        }
        if (macroId === "coder" && global.CodegenUtils) {
          var files = global.CodegenUtils.extractFileTree(blob);
          if (files.length) {
            var wrap = document.createElement("div");
            wrap.innerHTML = global.CodegenUtils.renderFileTreeHtml(files);
            out2.parentNode.appendChild(wrap);
          }
        }
      }
      if (global.NASE_Daemon) global.NASE_Daemon.probe();
    } catch (err) {
      meta.engines.forEach(function (id) {
        var iso = global.EngineIsolates.get(id);
        if (iso) iso.setError(String(err));
      });
      if (out) out.textContent = String(err && err.message ? err.message : err);
    } finally {
      btn.disabled = false;
    }
  }

  function mountAegis() {
    if (!root) return;
    activeRoute = { type: "aegis", id: "aegis" };
    root.innerHTML = "";
    var panel = el("div", "ws-panel");
    var snap = (global.NASE_Daemon && global.NASE_Daemon.getSnapshot()) || {
      hSys: "—",
      threat: "—",
      phi: []
    };
    panel.innerHTML =
      "<header class=\"ws-head\"><h1>Telemetry · NASE-AEGIS</h1>" +
      "<p class=\"muted\">Sole global state: H_sys · engines remain isolated</p></header>" +
      "<div class=\"aegis-metrics\">" +
      "<div class=\"metric\"><span class=\"lbl\">H_sys</span><span class=\"val\" id=\"metric-hsys\">" +
      snap.hSys +
      "</span></div>" +
      "<div class=\"metric\"><span class=\"lbl\">Threat</span><span class=\"val\" id=\"metric-threat\">" +
      snap.threat +
      "</span></div></div>" +
      "<div class=\"ws-chip-row\" id=\"aegis-phi-row\"></div>" +
      "<button type=\"button\" class=\"ws-primary-btn\" id=\"aegis-probe-btn\">Force Probe</button>";
    root.appendChild(panel);
    var row = document.getElementById("aegis-phi-row");
    (snap.phi || []).forEach(function (p, i) {
      row.appendChild(el("span", "ws-chip", "φ" + (i + 1) + " " + Number(p).toFixed(2)));
    });
    document.getElementById("aegis-probe-btn").addEventListener("click", function () {
      if (global.NASE_Daemon) {
        global.NASE_Daemon.probe().then(function () {
          mountAegis();
        });
      }
    });
    try {
      global.dispatchEvent(new CustomEvent("platform:route", { detail: activeRoute }));
    } catch (e) {}
  }

  function mountChat() {
    if (!root) return;
    activeRoute = { type: "chat", id: "vcs" };
    root.innerHTML = "";
    var panel = el("div", "ws-panel chat-panel");
    var st = global.ChatPartition.getState();
    var head = el("header", "ws-head");
    head.innerHTML =
      "<h1>Voltage Cipher Studio</h1><p class=\"muted\">Partitioned chat core · isolated from AST/codegen</p>";
    panel.appendChild(head);

    var controls = el("div", "chat-controls");
    var personaSel = document.createElement("select");
    personaSel.id = "chat-persona";
    global.ChatPartition.PERSONAS.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.glyph + " " + p.name;
      if (p.id === st.personaId) o.selected = true;
      personaSel.appendChild(o);
    });
    personaSel.addEventListener("change", function () {
      global.ChatPartition.setPersona(personaSel.value);
    });
    var modelSel = document.createElement("select");
    modelSel.id = "chat-model";
    var ogCoding = document.createElement("optgroup");
    ogCoding.label = "Coding Pro (Free)";
    var ogGen = document.createElement("optgroup");
    ogGen.label = "General Chat & Reasoning (Free)";
    global.ChatPartition.FREE_MODELS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.label;
      if (m.id === st.modelId) o.selected = true;
      (m.cat === "coding" ? ogCoding : ogGen).appendChild(o);
    });
    modelSel.appendChild(ogCoding);
    modelSel.appendChild(ogGen);
    modelSel.addEventListener("change", function () {
      global.ChatPartition.setModel(modelSel.value);
    });
    controls.appendChild(personaSel);
    controls.appendChild(modelSel);
    panel.appendChild(controls);

    var list = el("div", "chat-list");
    list.id = "chat-list";
    st.messages.forEach(function (m) {
      var b = el("div", "chat-bubble " + m.role + (m.failed ? " failed" : ""));
      b.textContent = m.content;
      list.appendChild(b);
    });
    panel.appendChild(list);

    var composer = el("div", "chat-composer");
    var ta = document.createElement("textarea");
    ta.id = "chat-input";
    ta.rows = 2;
    ta.placeholder = "Message…";
    var send = el("button", "ws-primary-btn", "Send");
    send.type = "button";
    send.addEventListener("click", async function () {
      var text = ta.value.trim();
      if (!text) return;
      ta.value = "";
      send.disabled = true;
      try {
        await global.ChatPartition.sendUserMessage(text);
      } catch (e) {}
      mountChat();
      send.disabled = false;
    });
    composer.appendChild(ta);
    composer.appendChild(send);
    panel.appendChild(composer);
    root.appendChild(panel);
    list.scrollTop = list.scrollHeight;
    try {
      global.dispatchEvent(new CustomEvent("platform:route", { detail: activeRoute }));
    } catch (e) {}
  }

  function mountEmpty() {
    if (!root) return;
    activeRoute = { type: "empty", id: null };
    root.innerHTML =
      "<div class=\"ws-panel\"><header class=\"ws-head\"><h1>Workspace</h1>" +
      "<p class=\"muted\">Select a suite item from the left navigation.</p></header></div>";
    try {
      global.dispatchEvent(new CustomEvent("platform:route", { detail: activeRoute }));
    } catch (e) {}
  }

  function navigate(route) {
    if (!route) return mountEmpty();
    if (route.type === "macro") return mountMacro(route.id, route.opts || {});
    if (route.type === "aegis") return mountAegis();
    if (route.type === "chat") return mountChat();
    mountEmpty();
  }

  global.WorkspaceRouter = {
    init: function (elRoot) {
      root = elRoot;
      mountEmpty();
      global.addEventListener("nase:force-research", function (ev) {
        mountMacro("research", { forcedRepair: true, hSys: ev.detail && ev.detail.hSys });
      });
    },
    navigate: navigate,
    getActive: function () {
      return activeRoute;
    },
    MACROS: MACROS
  };
})(typeof window !== "undefined" ? window : globalThis);
