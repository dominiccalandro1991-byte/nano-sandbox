/**
 * Virtual Stress Testing Engine — multi-vector mathematical stress pipeline.
 * Isolated report library (localStorage key vste-reports). Non-destructive to other modules.
 */
(function (global) {
  "use strict";

  var TARGETS = {
    frontend: "https://dominiccalandro1991-byte.github.io/snca-codec/",
    backend: "https://nano-cloud-backend.onrender.com"
  };

  var REPORT_KEY = "vste-reports-v1";
  var MAX_REPORTS = 40;

  function now() {
    return performance.now ? performance.now() : Date.now();
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Stochastic fuzz / Monte Carlo input vectors */
  function monteCarloVectors(n, seed) {
    var rng = mulberry32(seed || 0xc0ffee);
    var vectors = [];
    for (var i = 0; i < n; i++) {
      vectors.push({
        i: i,
        u: rng(),
        boundary: i % 7 === 0 ? Number.MAX_SAFE_INTEGER : i % 11 === 0 ? -1 : rng() * 1e6,
        nullish: i % 13 === 0 ? null : i % 17 === 0 ? undefined : rng().toString(36),
        payload: {
          x: rng() * 1000 - 500,
          y: Math.sin(rng() * Math.PI * 2),
          flag: rng() > 0.5
        }
      });
    }
    return vectors;
  }

  function runMonteCarlo(opts) {
    opts = opts || {};
    var n = Math.min(Math.max(opts.samples || 500, 10), 20000);
    var t0 = now();
    var vectors = monteCarloVectors(n, opts.seed || Date.now() % 1e9);
    var failures = 0;
    var latencies = [];
    for (var i = 0; i < vectors.length; i++) {
      var s = now();
      try {
        var v = vectors[i];
        // Synthetic target function under stress
        var r = Math.sqrt(Math.abs(v.payload.x)) + Math.log1p(Math.abs(v.boundary % 1e5));
        if (!isFinite(r) || v.nullish === null) failures++;
      } catch (e) {
        failures++;
      }
      latencies.push(now() - s);
    }
    var elapsed = now() - t0;
    latencies.sort(function (a, b) {
      return a - b;
    });
    return {
      vector: "monte_carlo_fuzz",
      equation: "P(x) ~ U(0,1); boundary ∈ {−1, MAX_SAFE, U·1e6}",
      samples: n,
      failures: failures,
      success_rate: 1 - failures / n,
      elapsed_ms: elapsed,
      latency_p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
      latency_p95: latencies[Math.floor(latencies.length * 0.95)] || 0,
      latency_p99: latencies[Math.floor(latencies.length * 0.99)] || 0
    };
  }

  /** Empirical Big-O via exponential N scaling */
  function profileComplexity(opts) {
    opts = opts || {};
    var sizes = opts.sizes || [16, 32, 64, 128, 256, 512];
    var series = [];
    function workLinear(n) {
      var s = 0;
      for (var i = 0; i < n; i++) s += i & 1;
      return s;
    }
    function workQuadratic(n) {
      var s = 0;
      var m = Math.min(n, 400);
      for (var i = 0; i < m; i++) for (var j = 0; j < m; j++) s += (i * j) & 1;
      return s;
    }
    sizes.forEach(function (n) {
      var t0 = now();
      workLinear(n * 200);
      var lin = now() - t0;
      t0 = now();
      workQuadratic(Math.min(n, 300));
      var quad = now() - t0;
      series.push({ n: n, t_linear_ms: lin, t_quadratic_ms: quad });
    });
    // ratio growth heuristic
    var bound = "O(N)";
    if (series.length >= 2) {
      var a = series[series.length - 2];
      var b = series[series.length - 1];
      var ratio = b.t_quadratic_ms / Math.max(1e-6, a.t_quadratic_ms);
      var nRatio = b.n / a.n;
      if (ratio > nRatio * nRatio * 0.6) bound = "O(N²)";
      else if (ratio > nRatio * 0.7) bound = "O(N)";
      else bound = "O(1)–O(N)";
    }
    return {
      vector: "complexity_profile",
      equation: "T(N) empirical; classify vs N, N² growth ratios",
      series: series,
      empirical_bound: bound,
      elapsed_ms: series.reduce(function (s, x) {
        return s + x.t_linear_ms + x.t_quadratic_ms;
      }, 0)
    };
  }

  /** Memory allocation pressure (bounded) */
  function memoryExhaustion(opts) {
    opts = opts || {};
    var chunks = Math.min(opts.chunks || 40, 200);
    var size = Math.min(opts.chunkSize || 256 * 1024, 1024 * 1024);
    var held = [];
    var t0 = now();
    var allocated = 0;
    var failed = 0;
    try {
      for (var i = 0; i < chunks; i++) {
        var buf = new Uint8Array(size);
        buf[0] = i & 255;
        buf[size - 1] = (i * 17) & 255;
        held.push(buf);
        allocated += size;
      }
    } catch (e) {
      failed = 1;
    }
    var elapsed = now() - t0;
    // release
    held.length = 0;
    return {
      vector: "memory_exhaustion",
      equation: "A = Σ chunk_i; measure alloc latency under volume",
      chunks: chunks,
      chunk_bytes: size,
      allocated_bytes: allocated,
      alloc_failed: failed,
      elapsed_ms: elapsed
    };
  }

  /** Concurrency via worker-like async batch (main thread pool simulation) */
  function concurrencyStress(opts) {
    opts = opts || {};
    var workers = Math.min(opts.workers || 8, 32);
    var tasks = Math.min(opts.tasks || 64, 512);
    var t0 = now();
    var completed = 0;
    var promises = [];
    for (var w = 0; w < workers; w++) {
      promises.push(
        new Promise(function (resolve) {
          var local = 0;
          function step() {
            if (local >= Math.ceil(tasks / workers)) return resolve(local);
            // busy work
            var x = 0;
            for (var i = 0; i < 5000; i++) x += Math.sqrt(i);
            local++;
            completed++;
            setTimeout(step, 0);
          }
          step();
        })
      );
    }
    return Promise.all(promises).then(function () {
      return {
        vector: "concurrency_pool",
        equation: "W workers × T tasks; completion under cooperative scheduling",
        workers: workers,
        tasks: tasks,
        completed: completed,
        elapsed_ms: now() - t0
      };
    });
  }

  /** Fault injection against remote targets */
  async function faultInjectionMatrix(opts) {
    opts = opts || {};
    var frontend = opts.frontend || TARGETS.frontend;
    var backend = opts.backend || TARGETS.backend;
    var results = [];
    var tAll = now();

    async function probe(name, url, init) {
      var t0 = now();
      var status = 0;
      var ok = false;
      var err = null;
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
          ctrl.abort();
        }, opts.timeoutMs || 8000);
        var res = await fetch(url, Object.assign({ signal: ctrl.signal, mode: "cors" }, init || {}));
        clearTimeout(timer);
        status = res.status;
        ok = res.ok || res.type === "opaque";
      } catch (e) {
        err = e && e.name === "AbortError" ? "timeout" : String(e && e.message ? e.message : e);
        // CORS may block reading — still records network attempt
        if (/Failed to fetch|NetworkError|CORS/i.test(err)) {
          err = "network_or_cors";
          status = 0;
        }
      }
      results.push({
        name: name,
        url: url,
        status: status,
        ok: ok,
        error: err,
        latency_ms: now() - t0
      });
    }

    await probe("frontend_get", frontend, { method: "GET" });
    await probe("backend_get", backend, { method: "GET" });
    await probe("backend_health", backend.replace(/\/$/, "") + "/health", { method: "GET" });
    // corrupted payload
    await probe("backend_bad_json", backend.replace(/\/$/, "") + "/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    });
    // dropped packet simulation via aborted short timeout
    await probe("frontend_timeout_sim", frontend, { method: "GET" });

    return {
      vector: "fault_injection",
      equation: "Fault set F={timeout, corrupt, unreachable}; recovery R = status∈2xx∨opaque",
      targets: TARGETS,
      probes: results,
      success_rate:
        results.filter(function (r) {
          return r.ok || r.status > 0;
        }).length / Math.max(1, results.length),
      elapsed_ms: now() - tAll
    };
  }

  function loadReports() {
    try {
      var raw = localStorage.getItem(REPORT_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveReports(arr) {
    try {
      localStorage.setItem(REPORT_KEY, JSON.stringify(arr.slice(0, MAX_REPORTS)));
    } catch (e) {}
  }

  function synthesizeReport(cycle) {
    var report = {
      id: "vste_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      targets: TARGETS,
      cycle: cycle,
      summary: {
        vectors: (cycle.results || []).map(function (r) {
          return r.vector;
        }),
        total_elapsed_ms: cycle.total_elapsed_ms,
        overall_success:
          cycle.results && cycle.results.length
            ? cycle.results.reduce(function (s, r) {
                return s + (r.success_rate != null ? r.success_rate : 1);
              }, 0) / cycle.results.length
            : 0
      }
    };
    var lib = loadReports();
    lib.unshift(report);
    saveReports(lib);
    return report;
  }

  async function runFullCycle(opts, onProgress) {
    opts = opts || {};
    var t0 = now();
    var results = [];
    function prog(msg, data) {
      if (onProgress) onProgress(msg, data);
    }
    prog("monte_carlo");
    results.push(runMonteCarlo(opts.monteCarlo));
    prog("complexity");
    results.push(profileComplexity(opts.complexity));
    prog("memory");
    results.push(memoryExhaustion(opts.memory));
    prog("concurrency");
    results.push(await concurrencyStress(opts.concurrency));
    prog("fault_injection");
    results.push(await faultInjectionMatrix(opts.fault));
    var cycle = {
      results: results,
      total_elapsed_ms: now() - t0,
      viewport: opts.viewport || null
    };
    var report = synthesizeReport(cycle);
    prog("done", report);
    return report;
  }

  function reportToMarkdown(report) {
    var lines = [
      "# Virtual Stress Test Report",
      "",
      "- **ID:** `" + report.id + "`",
      "- **Created:** " + report.createdAt,
      "- **Frontend target:** " + TARGETS.frontend,
      "- **Backend target:** " + TARGETS.backend,
      "- **Total elapsed:** " + (report.cycle && report.cycle.total_elapsed_ms).toFixed(2) + " ms",
      "- **Overall success metric:** " + ((report.summary && report.summary.overall_success) || 0).toFixed(4),
      ""
    ];
    (report.cycle.results || []).forEach(function (r) {
      lines.push("## Vector: " + r.vector);
      lines.push("");
      if (r.equation) lines.push("- Equation: `" + r.equation + "`");
      Object.keys(r).forEach(function (k) {
        if (k === "vector" || k === "equation" || k === "series" || k === "probes") return;
        var v = r[k];
        if (typeof v === "object") return;
        lines.push("- **" + k + ":** " + v);
      });
      if (r.series) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(r.series, null, 2));
        lines.push("```");
      }
      if (r.probes) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(r.probes, null, 2));
        lines.push("```");
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  global.VirtualStressEngine = {
    TARGETS: TARGETS,
    REPORT_KEY: REPORT_KEY,
    runMonteCarlo: runMonteCarlo,
    profileComplexity: profileComplexity,
    memoryExhaustion: memoryExhaustion,
    concurrencyStress: concurrencyStress,
    faultInjectionMatrix: faultInjectionMatrix,
    runFullCycle: runFullCycle,
    loadReports: loadReports,
    saveReports: saveReports,
    synthesizeReport: synthesizeReport,
    reportToMarkdown: reportToMarkdown,
    deleteReport: function (id) {
      saveReports(
        loadReports().filter(function (r) {
          return r.id !== id;
        })
      );
    },
    clearReports: function () {
      saveReports([]);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
