/**
 * Dedicated per-engine conversational workspace.
 * Routes all input to generative LLM (SSE) — no NASE JSON diagnostic interception.
 */
(function (global) {
  "use strict";

  var histories = {}; // engineKey -> messages[]
  var activeKey = null;
  var root = null;
  var streaming = false;

  var ENGINE_META = {
    research: { title: "Research Engine Chat", engines: [1, 2, 3, 4, 5], engineId: 1 },
    inventor: { title: "Inventor Engine Chat", engines: [6, 7, 8, 9, 10], engineId: 6 },
    coder: { title: "Coder Engine Chat · φ11–15", engines: [11, 12, 13, 14, 15], engineId: 11 },
    deploy: { title: "Deploy Engine Chat", engines: [16, 17, 18, 19, 20], engineId: 16 },
    chat: { title: "Chat Macro Engine", engines: [21, 22, 23, 24, 25], engineId: 21 }
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function backendBase() {
    try {
      if (global.__NNACC_REMOTE__ && /^https?:\/\//i.test(global.__NNACC_REMOTE__))
        return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      var s = localStorage.getItem("nnacc-v2-remote") || localStorage.getItem("vcs-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return (global.NASE_Daemon && global.NASE_Daemon.backendBase()) || "https://nano-sandbox-api.onrender.com";
  }

  function getHistory(key) {
    if (!histories[key]) histories[key] = [];
    return histories[key];
  }

  function downloadBlob(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 500);
  }

  function downloadZipApprox(files) {
    // No zip lib: emit multi-file markdown bundle + individual saves available
    var parts = ["# Generated bundle\n"];
    (files || []).forEach(function (f) {
      parts.push("\n## " + f.path + "\n\n```\n" + f.content + "\n```\n");
    });
    downloadBlob("engine-bundle.md", parts.join(""), "text/markdown;charset=utf-8");
  }

  function renderMessages(listEl, msgs) {
    listEl.innerHTML = "";
    msgs.forEach(function (m) {
      var div = el("div", "msg " + m.role + (m.failed ? " failed" : ""));
      var meta = el("div", "msg-meta");
      meta.textContent = m.role === "user" ? "You" : "Engine";
      div.appendChild(meta);
      var body = el("div", "msg-body");
      body.textContent = m.content || "";
      div.appendChild(body);
      if (m.files && m.files.length && global.CodegenUtils) {
        var tree = el("div", "file-tree");
        tree.innerHTML =
          '<div class="file-tree-head">Virtual file tree (' +
          m.files.length +
          ') <button type="button" class="copy-file-btn bundle-dl">Download all</button></div>';
        m.files.forEach(function (f, i) {
          var det = document.createElement("details");
          det.className = "file-tree-item";
          det.innerHTML =
            "<summary><code>" +
            escapeHtml(f.path) +
            '</code> <button type="button" class="copy-file-btn" data-act="copy" data-i="' +
            i +
            '">Copy</button> <button type="button" class="copy-file-btn" data-act="dl" data-i="' +
            i +
            '">Download</button></summary><pre class="file-tree-code">' +
            escapeHtml(f.content) +
            "</pre>";
          tree.appendChild(det);
        });
        tree.querySelector(".bundle-dl").addEventListener("click", function () {
          downloadZipApprox(m.files);
        });
        tree.querySelectorAll("[data-act]").forEach(function (btn) {
          btn.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var i = Number(btn.getAttribute("data-i"));
            var f = m.files[i];
            if (!f) return;
            if (btn.getAttribute("data-act") === "copy") {
              if (navigator.clipboard) navigator.clipboard.writeText(f.content);
            } else {
              downloadBlob(f.path.replace(/\//g, "_"), f.content);
            }
          });
        });
        div.appendChild(tree);
      }
      listEl.appendChild(div);
    });
    listEl.scrollTop = listEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function streamLLM(payload, onToken) {
    var base = backendBase();
    var maxOut =
      global.CodegenUtils && global.CodegenUtils.computeMaxOut
        ? global.CodegenUtils.computeMaxOut(payload.model, payload.messages)
        : 8192;
    payload.max_tokens = maxOut;

    try {
      var res = await fetch(base + "/llm/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload)
      });
      if (res.ok && res.body) {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var full = "";
        var buf = "";
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf("data:") !== 0) continue;
            var data = line.replace(/^data:\s*/, "");
            if (data === "[DONE]") continue;
            try {
              var j = JSON.parse(data);
              if (j.error) throw new Error(String(j.error));
              var delta =
                j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (delta) {
                full += delta;
                if (onToken) onToken(delta, full);
              }
            } catch (e) {
              if (e && e.message && e.message.indexOf("JSON") === -1) throw e;
            }
          }
        }
        return { content: full };
      }
    } catch (e) {
      try {
        console.warn("[EngineChat] stream fallback", e);
      } catch (x) {}
    }

    var res2 = await fetch(base + "/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    var body = await res2.json().catch(function () {
      return {};
    });
    if (!res2.ok) {
      var d = body.detail;
      if (typeof d === "object") d = d.message || JSON.stringify(d);
      throw new Error(d || "LLM HTTP " + res2.status);
    }
    var content = body.content || body.result || "";
    if (onToken) onToken(content, content);
    return body;
  }

  function mount(container, key) {
    root = container;
    activeKey = key;
    var meta = ENGINE_META[key] || {
      title: "Engine " + key,
      engines: [],
      engineId: null
    };
    var msgs = getHistory(key);
    root.innerHTML = "";
    var panel = el("div", "engine-chat-panel");
    panel.innerHTML =
      '<header class="ws-head"><h1>' +
      meta.title +
      '</h1><p class="muted">Conversational workspace · generative only · φ ' +
      (meta.engines.join(", ") || "—") +
      "</p></header>";

    // ingest
    var ingest = el("div", "ingest-zone compact");
    ingest.innerHTML =
      '<div class="ingest-drop"><span>Drop files or click to attach</span>' +
      '<input type="file" multiple accept="*/*" class="ingest-input" /></div>' +
      '<ul class="ingest-file-list"></ul>';
    panel._files = [];
    var drop = ingest.querySelector(".ingest-drop");
    var input = ingest.querySelector(".ingest-input");
    var flist = ingest.querySelector(".ingest-file-list");
    function paintFiles() {
      flist.innerHTML = "";
      panel._files.forEach(function (f, idx) {
        var li = document.createElement("li");
        li.textContent = f.name;
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "ingest-remove";
        rm.textContent = "✕";
        rm.onclick = function () {
          panel._files.splice(idx, 1);
          paintFiles();
        };
        li.appendChild(rm);
        flist.appendChild(li);
      });
    }
    async function addFiles(fileList) {
      // lightweight text/base64 via FileReader — reuse pattern
      var arr = Array.prototype.slice.call(fileList || []);
      for (var i = 0; i < arr.length; i++) {
        var file = arr[i];
        await new Promise(function (resolve) {
          var r = new FileReader();
          r.onload = function () {
            var content = r.result;
            var encoding = "utf8";
            if (typeof content !== "string") content = "";
            else if (content.indexOf("data:") === 0 && content.indexOf(",") >= 0) {
              encoding = "base64";
              content = content.split(",")[1];
            }
            panel._files.push({
              name: file.name,
              size: file.size,
              type: file.type,
              encoding: encoding,
              content: content
            });
            resolve();
          };
          if (/\.(txt|md|json|js|ts|tsx|jsx|py|go|rs|css|html|yml|yaml|toml|sh|sql)$/i.test(file.name))
            r.readAsText(file);
          else r.readAsDataURL(file);
        });
      }
      paintFiles();
    }
    drop.onclick = function () {
      input.click();
    };
    input.onchange = function () {
      if (input.files) addFiles(input.files);
      input.value = "";
    };
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", function () {
      drop.classList.remove("dragover");
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("dragover");
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    panel.appendChild(ingest);

    // language multi — reuse taxonomy from WorkspaceRouter if present
    var langHost = el("div", "lang-host");
    panel.appendChild(langHost);
    panel._languages = ["TypeScript"];
    if (global.WorkspaceRouter && global.WorkspaceRouter.buildLanguageMultiSelect) {
      global.WorkspaceRouter.buildLanguageMultiSelect(langHost);
      // form._languages is on host if we attach the same API
    } else {
      // minimal: inject via internal builder from taxonomy on window
      buildInlineLang(langHost, panel);
    }
    // Prefer languages from langHost
    Object.defineProperty(panel, "_languages", {
      get: function () {
        return langHost._languages || panel.__langs || ["TypeScript"];
      },
      set: function (v) {
        panel.__langs = v;
      }
    });

    var toolbar = el("div", "engine-chat-toolbar");
    toolbar.innerHTML =
      '<button type="button" class="ghost-btn" id="engine-export-md">Export Markdown</button>' +
      '<button type="button" class="ghost-btn" id="engine-export-json">Export JSON</button>' +
      '<button type="button" class="ghost-btn danger" id="engine-clear">Clear thread</button>';
    panel.appendChild(toolbar);

    var list = el("div", "message-list engine-msg-list");
    panel.appendChild(list);
    renderMessages(list, msgs);

    var composer = el("div", "composer-dock");
    composer.innerHTML =
      '<textarea id="engine-composer" rows="1" placeholder="Message this engine…"></textarea>' +
      '<button type="button" class="send-btn" id="engine-send">Send</button>';
    panel.appendChild(composer);
    root.appendChild(panel);

    // Wire language builder onto langHost as form-like
    if (!(langHost._languages && langHost._languages.length)) {
      buildInlineLang(langHost, panel);
    }

    function exportMd() {
      var lines = ["# " + meta.title, ""];
      getHistory(key).forEach(function (m) {
        lines.push("## " + (m.role === "user" ? "User" : "Engine"));
        lines.push("");
        lines.push(m.content || "");
        lines.push("");
      });
      downloadBlob(key + "-session.md", lines.join("\n"), "text/markdown;charset=utf-8");
    }
    function exportJson() {
      downloadBlob(
        key + "-session.json",
        JSON.stringify({ engine: key, meta: meta, messages: getHistory(key) }, null, 2),
        "application/json"
      );
    }
    toolbar.querySelector("#engine-export-md").onclick = exportMd;
    toolbar.querySelector("#engine-export-json").onclick = exportJson;
    toolbar.querySelector("#engine-clear").onclick = function () {
      histories[key] = [];
      renderMessages(list, getHistory(key));
    };

    var sendBtn = panel.querySelector("#engine-send");
    var ta = panel.querySelector("#engine-composer");
    async function send() {
      if (streaming) return;
      var text = (ta.value || "").trim();
      if (!text) return;
      ta.value = "";
      streaming = true;
      sendBtn.disabled = true;
      var hist = getHistory(key);
      var langs = langHost._languages || panel._languages || ["TypeScript"];
      var attach = panel._files || [];
      var contextBits = [];
      if (langs.length) contextBits.push("Target languages: " + langs.join(", "));
      if (attach.length) {
        contextBits.push(
          "Attached files:\n" +
            attach
              .map(function (f) {
                var body = f.content || "";
                if (body.length > 12000) body = body.slice(0, 12000) + "\n…[truncated]";
                return "### " + f.name + "\n```\n" + body + "\n```";
              })
              .join("\n")
        );
      }
      var userContent =
        (contextBits.length ? contextBits.join("\n\n") + "\n\n" : "") + text;
      hist.push({ role: "user", content: text, ts: Date.now() });
      var assistant = { role: "assistant", content: "", ts: Date.now(), files: [] };
      hist.push(assistant);
      renderMessages(list, hist);

      var model =
        (global.ChatPartition && global.ChatPartition.getState().modelId) ||
        "google/gemma-4-26b-a4b-it:free";
      try {
        var saved = localStorage.getItem("vcs-model");
        if (saved) model = saved;
      } catch (e) {}

      var apiMessages = hist
        .filter(function (m) {
          return m !== assistant && !m.failed;
        })
        .map(function (m) {
          return { role: m.role, content: m.content };
        });
      // last user should include attachment context for the model
      if (apiMessages.length && apiMessages[apiMessages.length - 1].role === "user") {
        apiMessages[apiMessages.length - 1] = { role: "user", content: userContent };
      }

      try {
        var result = await streamLLM(
          {
            model: model,
            messages: apiMessages,
            engine_id: meta.engineId,
            persona: null
          },
          function (delta, full) {
            assistant.content = full;
            renderMessages(list, hist);
          }
        );
        assistant.content = result.content || result.result || assistant.content;
        if (global.CodegenUtils && global.CodegenUtils.extractFileTree) {
          assistant.files = global.CodegenUtils.extractFileTree(assistant.content);
        }
        // multi-pass continuation
        var passes = 0;
        while (
          passes < 3 &&
          global.CodegenUtils &&
          global.CodegenUtils.needsContinuation(assistant.content, result)
        ) {
          passes++;
          var cont = await streamLLM(
            {
              model: model,
              messages: apiMessages.concat([
                { role: "assistant", content: assistant.content },
                {
                  role: "user",
                  content:
                    "CONTINUE from exact stop. Path-tagged code fences only for remainder. Pass " +
                    (passes + 1)
                }
              ]),
              engine_id: meta.engineId
            },
            function (d, full) {
              assistant.content =
                assistant.content.replace(/\s*CONTINUE_NEEDED\s*$/i, "") + full;
              renderMessages(list, hist);
            }
          );
          var more = cont.content || cont.result || "";
          assistant.content =
            assistant.content.replace(/\s*CONTINUE_NEEDED\s*$/i, "") + more;
          result = cont;
        }
        if (global.CodegenUtils) {
          assistant.files = global.CodegenUtils.extractFileTree(assistant.content);
        }
        // isolate bag update
        (meta.engines || []).forEach(function (id) {
          var iso = global.EngineIsolates && global.EngineIsolates.get(id);
          if (iso) iso.setOutput({ chat: true, chars: (assistant.content || "").length });
        });
      } catch (err) {
        assistant.content = err && err.message ? err.message : String(err);
        assistant.failed = true;
      }
      renderMessages(list, hist);
      streaming = false;
      sendBtn.disabled = false;
    }
    sendBtn.onclick = send;
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  function buildInlineLang(host, panel) {
    var tax =
      (global.WorkspaceRouter && global.WorkspaceRouter.LANGUAGE_TAXONOMY) || null;
    var flat =
      global.WorkspaceRouter && global.WorkspaceRouter.flatLanguageCatalog
        ? global.WorkspaceRouter.flatLanguageCatalog()
        : null;
    if (!flat && global.WorkspaceRouter && global.WorkspaceRouter.LANGUAGE_CATALOG) {
      flat = global.WorkspaceRouter.LANGUAGE_CATALOG.map(function (l) {
        return { lang: l, group: "Languages" };
      });
    }
    if (!flat) {
      flat = [
        { lang: "TypeScript", group: "Web" },
        { lang: "Python 3.x", group: "Application" },
        { lang: "Go", group: "Systems" },
        { lang: "Rust", group: "Systems" },
        { lang: "SQL", group: "Database" }
      ];
    }
    host._languages = ["TypeScript"];
    var ROW_H = 34;
    var VIEW_H = 160;
    host.innerHTML =
      '<label class="ws-field"><span>Languages</span>' +
      '<input type="search" class="lang-search" placeholder="Search taxonomy…" /></label>' +
      '<div class="lang-selected"></div>' +
      '<div class="lang-viewport" style="height:' +
      VIEW_H +
      'px;overflow:auto;position:relative;border:1px solid var(--border);border-radius:8px">' +
      '<div class="lang-spacer"></div><div class="lang-window" style="position:absolute;left:0;right:0;top:0"></div></div>';
    var search = host.querySelector(".lang-search");
    var selectedEl = host.querySelector(".lang-selected");
    var viewport = host.querySelector(".lang-viewport");
    var spacer = host.querySelector(".lang-spacer");
    var windowEl = host.querySelector(".lang-window");
    var selected = host._languages;
    var filtered = flat.slice();
    function paintSelected() {
      selectedEl.innerHTML = "";
      selected.forEach(function (lang) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "lang-chip";
        chip.textContent = lang + " ✕";
        chip.onclick = function () {
          selected = selected.filter(function (x) {
            return x !== lang;
          });
          host._languages = selected;
          paintSelected();
          renderWindow();
        };
        selectedEl.appendChild(chip);
      });
      host._languages = selected.slice();
    }
    function renderWindow() {
      var start = Math.max(0, Math.floor(viewport.scrollTop / ROW_H) - 2);
      var end = Math.min(filtered.length, start + Math.ceil(VIEW_H / ROW_H) + 4);
      spacer.style.height = filtered.length * ROW_H + "px";
      windowEl.style.transform = "translateY(" + start * ROW_H + "px)";
      windowEl.innerHTML = "";
      for (var i = start; i < end; i++) {
        var row = filtered[i];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "lang-option" + (selected.indexOf(row.lang) >= 0 ? " is-selected" : "");
        btn.style.height = ROW_H + "px";
        btn.textContent = row.lang;
        btn.onclick = (function (lang) {
          return function () {
            if (selected.indexOf(lang) >= 0)
              selected = selected.filter(function (x) {
                return x !== lang;
              });
            else selected.push(lang);
            host._languages = selected;
            paintSelected();
            renderWindow();
          };
        })(row.lang);
        windowEl.appendChild(btn);
      }
    }
    search.oninput = function () {
      var q = search.value.trim().toLowerCase();
      filtered = !q
        ? flat.slice()
        : flat.filter(function (r) {
            return r.lang.toLowerCase().indexOf(q) !== -1;
          });
      viewport.scrollTop = 0;
      renderWindow();
    };
    viewport.onscroll = renderWindow;
    paintSelected();
    renderWindow();
  }

  global.EngineChat = {
    mount: mount,
    ENGINE_META: ENGINE_META
  };
})(typeof window !== "undefined" ? window : globalThis);
