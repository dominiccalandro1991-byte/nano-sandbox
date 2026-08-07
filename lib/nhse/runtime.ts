/**
 * Runtime adapter — App-Store-legal live module execution.
 *
 * Native binary execution inside another app is impossible under iOS policy,
 * so the engine runs habitat modules on the platform's own interpreter inside
 * a Web Worker: a separate thread, no DOM handle, no network by construction
 * (the worker source is a blob with no fetch usage), and a hard wall-clock
 * budget enforced from the host thread via terminate().
 *
 * A CommonJS-style loader resolves imports *from the habitat itself*, so a
 * multi-file module graph runs exactly as authored.
 */

import type { RunLogLine, RunResult } from "./types"

const WORKER_SOURCE = String.raw`
var __logs = [];
function __push(level, args) {
  var parts = [];
  for (var i = 0; i < args.length; i++) {
    var value = args[i];
    if (typeof value === "string") { parts.push(value); continue; }
    try { parts.push(JSON.stringify(value)); } catch (error) { parts.push(String(value)); }
  }
  __logs.push({ level: level, text: parts.join(" "), ts: Date.now() });
  if (__logs.length > 500) { __logs.shift(); }
}
var console = {
  log: function () { __push("log", arguments); },
  info: function () { __push("info", arguments); },
  warn: function () { __push("warn", arguments); },
  error: function () { __push("error", arguments); },
  debug: function () { __push("log", arguments); }
};

function __normalize(fromPath, specifier) {
  var fromDir = fromPath.indexOf("/") === -1 ? "" : fromPath.slice(0, fromPath.lastIndexOf("/"));
  var segments = (fromDir + "/" + specifier).split("/");
  var stack = [];
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    if (segment === "" || segment === ".") { continue; }
    if (segment === "..") { stack.pop(); continue; }
    stack.push(segment);
  }
  return stack.join("/");
}

self.onmessage = function (event) {
  var files = event.data.files || {};
  var entry = event.data.entry;
  var cache = {};
  var stack = [];

  function resolve(fromPath, specifier) {
    var base = specifier.charAt(0) === "." ? __normalize(fromPath, specifier) : specifier;
    var candidates = [base, base + ".js", base + ".mjs", base + ".json", base + "/index.js"];
    for (var i = 0; i < candidates.length; i++) {
      if (Object.prototype.hasOwnProperty.call(files, candidates[i])) { return candidates[i]; }
    }
    throw new Error("Module not found in habitat: " + specifier + " (from " + fromPath + ")");
  }

  function load(path) {
    if (cache[path]) { return cache[path].exports; }
    if (stack.indexOf(path) !== -1) {
      throw new Error("Circular require detected: " + stack.concat([path]).join(" -> "));
    }
    var moduleObject = { exports: {}, id: path };
    cache[path] = moduleObject;
    stack.push(path);
    var source = files[path];
    if (path.slice(-5) === ".json") {
      moduleObject.exports = JSON.parse(source);
      stack.pop();
      return moduleObject.exports;
    }
    var factory = new Function(
      "exports",
      "require",
      "module",
      "console",
      "__filename",
      '"use strict";' + source + "\n//# sourceURL=nhse://" + path
    );
    factory(
      moduleObject.exports,
      function (specifier) { return load(resolve(path, specifier)); },
      moduleObject,
      console,
      path
    );
    stack.pop();
    return moduleObject.exports;
  }

  var started = Date.now();
  try {
    var exported = load(entry);
    var result = null;
    if (exported && typeof exported === "object" && "result" in exported) {
      try { result = JSON.parse(JSON.stringify(exported.result)); } catch (error) { result = String(exported.result); }
    } else if (typeof exported === "function") {
      try { result = JSON.parse(JSON.stringify(exported())); } catch (error) { result = null; }
    }
    self.postMessage({ ok: true, logs: __logs, error: null, result: result, durationMs: Date.now() - started });
  } catch (error) {
    var message = error && error.stack ? String(error.stack) : String(error);
    self.postMessage({ ok: false, logs: __logs, error: message, result: null, durationMs: Date.now() - started });
  }
};
`

export interface RunOptions {
  entry: string
  files: Record<string, string>
  timeoutMs?: number
}

/**
 * Execute a habitat module. Resolves — never rejects — so a runaway module can
 * never take the host UI down with it.
 */
export function runLiveModule(options: RunOptions): Promise<RunResult> {
  const { entry, files } = options
  const timeoutMs = options.timeoutMs ?? 4000
  const started = typeof performance !== "undefined" ? performance.now() : Date.now()

  const fail = (error: string, logs: RunLogLine[] = []): RunResult => ({
    ok: false,
    entry,
    logs,
    error,
    durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started),
    result: null,
  })

  if (!(entry in files)) {
    return Promise.resolve(fail(`Entry module "${entry}" is not present in this habitat.`))
  }
  if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(fail("This platform does not expose Web Workers; the runtime adapter is unavailable."))
  }

  return new Promise<RunResult>((resolve) => {
    let settled = false
    let url = ""
    let worker: Worker | null = null

    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        worker?.terminate()
      } catch {
        // Worker already gone.
      }
      if (url) URL.revokeObjectURL(url)
      resolve(result)
    }

    const timer = window.setTimeout(() => {
      finish(fail(`Execution exceeded the ${timeoutMs} ms working-set budget and was terminated.`))
    }, timeoutMs)

    try {
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }))
      worker = new Worker(url)
      worker.onmessage = (event: MessageEvent) => {
        const payload = event.data as {
          ok: boolean
          logs: RunLogLine[]
          error: string | null
          result: unknown
          durationMs: number
        }
        finish({
          ok: payload.ok,
          entry,
          logs: Array.isArray(payload.logs) ? payload.logs : [],
          error: payload.error,
          durationMs: payload.durationMs,
          result: payload.result,
        })
      }
      worker.onerror = (event: ErrorEvent) => {
        finish(fail(event.message || "Runtime adapter raised an unrecoverable error."))
      }
      worker.postMessage({ entry, files })
    } catch (error) {
      finish(fail(error instanceof Error ? error.message : String(error)))
    }
  })
}
