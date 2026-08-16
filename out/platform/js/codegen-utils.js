/**
 * Context budget, multi-pass continuation, file-tree extraction from path-tagged fences.
 */
(function (global) {
  "use strict";

  var MODEL_CONTEXT = {
    "poolside/laguna-s-2.1:free": 131072,
    "poolside/laguna-xs-2.1:free": 131072,
    "openai/gpt-oss-20b:free": 131072,
    "nvidia/nemotron-3-ultra-550b-a55b:free": 262144,
    "nvidia/nemotron-3-super-120b-a12b:free": 262144,
    "google/gemma-4-26b-a4b-it:free": 131072
  };
  var DELTA = 256;
  var HARD_CAP = 65536;

  function estimateTokens(text) {
    return Math.max(1, Math.ceil(String(text || "").length / 4));
  }

  function computeMaxOut(modelId, messages) {
    var cMax = MODEL_CONTEXT[modelId] || 131072;
    var tin = 64;
    (messages || []).forEach(function (m) {
      tin += estimateTokens(m.content) + 4;
    });
    var budget = cMax - tin - DELTA;
    if (budget < 256) budget = 256;
    return Math.min(budget, HARD_CAP);
  }

  /**
   * Extract ```path\ncode``` or ```lang path\ncode``` blocks into virtual file tree.
   */
  function extractFileTree(markdown) {
    var text = String(markdown || "");
    var files = [];
    var re = /```([^\n`]*)\n([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text))) {
      var header = (m[1] || "").trim();
      var code = m[2] || "";
      var path = null;
      if (header.indexOf("/") !== -1 || /\.\w{1,8}$/.test(header)) {
        path = header.split(/\s+/).pop();
      } else if (/^(tsx?|jsx?|py|go|rs|java|css|html|json|md|vue|svelte)$/i.test(header)) {
        path = null;
      } else if (header) {
        path = header;
      }
      if (path) {
        files.push({ path: path.replace(/^\/+/, ""), content: code.replace(/\n$/, "") });
      }
    }
    return files;
  }

  function renderFileTreeHtml(files) {
    if (!files || !files.length) return "";
    var html =
      '<div class="file-tree"><div class="file-tree-head">Virtual file tree (' +
      files.length +
      ")</div>";
    files.forEach(function (f, i) {
      html +=
        '<details class="file-tree-item"><summary><code>' +
        escapeHtml(f.path) +
        '</code> <button type="button" class="copy-file-btn" data-idx="' +
        i +
        '">Copy</button></summary><pre class="file-tree-code">' +
        escapeHtml(f.content) +
        "</pre></details>";
    });
    html += "</div>";
    return html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function needsContinuation(text, meta) {
    if (meta && meta.continue_needed) return true;
    if (meta && meta.finish_reason === "length") return true;
    var t = String(text || "");
    if (/CONTINUE_NEEDED/i.test(t.slice(-120))) return true;
    return false;
  }

  global.CodegenUtils = {
    MODEL_CONTEXT: MODEL_CONTEXT,
    DELTA: DELTA,
    estimateTokens: estimateTokens,
    computeMaxOut: computeMaxOut,
    extractFileTree: extractFileTree,
    renderFileTreeHtml: renderFileTreeHtml,
    needsContinuation: needsContinuation
  };
})(typeof window !== "undefined" ? window : globalThis);
