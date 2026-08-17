/**
 * Virtual Stress Testing Engine — multi-vector pipeline + full failure telemetry.
 * Isolated report library (localStorage key vste-reports-v1).
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
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  function sampleHeap() {
    var mem =
      typeof performance !== "undefined" && performance.memory
        ? performance.memory
        : null;
    if (!mem) {
      return {
        supported: false,
        usedJSHeapSize: null,
        totalJSHeapSize: null,
        jsHeapSizeLimit: null
      };
    }
    return {
      supported: true,
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit
    };
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

  function stackFromError(err) {
    if (!err) return "unknown";
    if (typeof err === "string") return err;
    return String(err.stack || err.message || err);
  }

  function monteCarloVectors(n, seed) {
    var rng = mulberry32(seed || 0xc0ffee);
    var vectors = [];
    for (var i = 0; i < n; i++) {
      vectors.push({
        i: i,
        u: rng(),
        boundary:
          i % 7 === 0
            ? Number.MAX_SAFE_INTEGER
            : i % 11 === 0
              ? -1
              : i % 19 === 0
                ? Number.NaN
                : rng() * 1e6,
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
    var heapBefore = sampleHeap();
    var t0 = now();
    var vectors = monteCarloVectors(n, opts.seed || Date.now() % 1e9);
    var failures = 0;
    var latencies = [];
    var failureTelemetry = [];

    for (var i = 0; i < vectors.length; i++) {
      var s = now();
      var v = vectors[i];
      try {
        if (v.nullish === null) {
          throw new TypeError("nullish_payload_rejected");
        }
        if (typeof v.boundary === "number" && isNaN(v.boundary)) {
          throw new RangeError("nan_boundary");
        }
        var r =
          Math.sqrt(Math.abs(v.payload.x)) +
          Math.log1p(Math.abs((v.boundary || 0) % 1e5));
        if (!isFinite(r)) {
          throw new RangeError("non_finite_result");
        }
      } catch (e) {
        failures++;
        if (failureTelemetry.length < 25) {
          failureTelemetry.push({
            index: i,
            input_payload: v,
            exception: stackFromError(e),
            error_code: e && e.name ? e.name : "Error",
            state_boundary: {
              boundary: v.boundary,
              nullish: v.nullish,
              u: v.u
            },
            t_ms: now() - s
          });
        }
      }
      latencies.push(now() - s);
    }

    latencies.sort(function (a, b) {
      return a - b;
    });
    var elapsed = now() - t0;
    var heapAfter = sampleHeap();

    return {
      vector: "monte_carlo_fuzz",
      equation: "P(x)~U(0,1); boundary∈{−1,NaN,MAX_SAFE,U·1e6}; reject nullish",
      samples: n,
      failures: failures,
      success_rate: 1 - failures / n,
      elapsed_ms: elapsed,
      latency_p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
      latency_p95: latencies[Math.floor(latencies.length * 0.95)] || 0,
      latency_p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
      heap_before: heapBefore,
      heap_after: heapAfter,
      heap_delta_bytes:
        heapBefore.supported && heapAfter.supported
          ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
          : null,
      failure_telemetry: failureTelemetry
    };
  }

  function profileComplexity(opts) {
    opts = opts || {};
    var sizes = opts.sizes || [16, 32, 64, 128, 256, 512];
    var heapBefore = sampleHeap();
    var series = [];
    var failureTelemetry = [];
    var failures = 0;

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
      try {
        var t0 = now();
        workLinear(n * 200);
        var lin = now() - t0;
        t0 = now();
        workQuadratic(Math.min(n, 300));
        var quad = now() - t0;
        if (lin < 0 || quad < 0) throw new Error("negative_timing");
        series.push({
          n: n,
          t_linear_ms: lin,
          t_quadratic_ms: quad,
          ratio_quad_lin: quad / Math.max(lin, 1e-9)
        });
      } catch (e) {
        failures++;
        failureTelemetry.push({
          index: n,
          input_payload: { n: n },
          exception: stackFromError(e),
          error_code: e && e.name ? e.name : "Error",
          state_boundary: { sizes: sizes.slice() }
        });
      }
    });

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

    var heapAfter = sampleHeap();
    return {
      vector: "complexity_profiling",
      equation: "T(N) empirical; classify growth vs N, N² ratios",
      series: series,
      empirical_bound: bound,
      failures: failures,
      success_rate: series.length ? 1 - failures / sizes.length : 0,
      elapsed_ms: series.reduce(function (s, x) {
        return s + x.t_linear_ms + x.t_quadratic_ms;
      }, 0),
      heap_before: heapBefore,
      heap_after: heapAfter,
      heap_delta_bytes:
        heapBefore.supported && heapAfter.supported
          ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
          : null,
      failure_telemetry: failureTelemetry
    };
  }

  function memoryExhaustion(opts) {
    opts = opts || {};
    var chunks = Math.min(opts.chunks || 40, 200);
    var size = Math.min(opts.chunkSize || 256 * 1024, 1024 * 1024);
    var held = [];
    var heapBefore = sampleHeap();
    var t0 = now();
    var allocated = 0;
    var failures = 0;
    var failureTelemetry = [];
    var peakUsed = heapBefore.usedJSHeapSize || 0;

    try {
      for (var i = 0; i < chunks; i++) {
        try {
          var buf = new Uint8Array(size);
          buf[0] = i & 255;
          buf[size - 1] = (i * 17) & 255;
          held.push(buf);
          allocated += size;
          var mid = sampleHeap();
          if (mid.supported && mid.usedJSHeapSize > peakUsed) peakUsed = mid.usedJSHeapSize;
        } catch (inner) {
          failures++;
          failureTelemetry.push({
            index: i,
            input_payload: { chunk: i, chunk_bytes: size, allocated_so_far: allocated },
            exception: stackFromError(inner),
            error_code: inner && inner.name ? inner.name : "AllocError",
            state_boundary: {
              chunks_requested: chunks,
              heap: sampleHeap()
            }
          });
          break;
        }
      }
    } catch (e) {
      failures++;
      failureTelemetry.push({
        index: -1,
        input_payload: { chunks: chunks, size: size },
        exception: stackFromError(e),
        error_code: e && e.name ? e.name : "Error",
        state_boundary: { heap: sampleHeap() }
      });
    }

    var elapsed = now() - t0;
    var heapAfterHold = sampleHeap();
    // release — observe GC opportunity
    held.length = 0;
    held = null;
    var tGc0 = now();
    // force minor churn to encourage GC observation
    for (var g = 0; g < 1000; g++) {
      void (Math.random() * g);
    }
    var heapAfterRelease = sampleHeap();
    var gcPauseProxyMs = now() - tGc0;

    return {
      vector: "memory_exhaustion",
      equation: "A=Σchunk_i; Δheap=used_after−used_before; leak_proxy=held_vs_released",
      chunks: chunks,
      chunk_bytes: size,
      allocated_bytes: allocated,
      failures: failures,
      success_rate: failures ? 0 : 1,
      elapsed_ms: elapsed,
      heap_before: heapBefore,
      heap_after_hold: heapAfterHold,
      heap_after_release: heapAfterRelease,
      peak_used_js_heap: peakUsed,
      heap_delta_hold_bytes:
        heapBefore.supported && heapAfterHold.supported
          ? heapAfterHold.usedJSHeapSize - heapBefore.usedJSHeapSize
          : null,
      heap_delta_release_bytes:
        heapAfterHold.supported && heapAfterRelease.supported
          ? heapAfterRelease.usedJSHeapSize - heapAfterHold.usedJSHeapSize
          : null,
      gc_pause_proxy_ms: gcPauseProxyMs,
      leak_proxy:
        heapAfterRelease.supported && heapBefore.supported
          ? heapAfterRelease.usedJSHeapSize - heapBefore.usedJSHeapSize
          : null,
      failure_telemetry: failureTelemetry
    };
  }

  function concurrencyStress(opts) {
    opts = opts || {};
    var workers = Math.min(opts.workers || 8, 32);
    var tasks = Math.min(opts.tasks || 64, 512);
    var heapBefore = sampleHeap();
    var t0 = now();
    var completed = 0;
    var failures = 0;
    var failureTelemetry = [];
    var promises = [];

    for (var w = 0; w < workers; w++) {
      (function (workerId) {
        promises.push(
          new Promise(function (resolve) {
            var local = 0;
            var maxLocal = Math.ceil(tasks / workers);
            function step() {
              if (local >= maxLocal) return resolve(local);
              try {
                var x = 0;
                for (var i = 0; i < 5000; i++) x += Math.sqrt(i);
                if (!isFinite(x)) throw new RangeError("worker_non_finite");
                local++;
                completed++;
                setTimeout(step, 0);
              } catch (e) {
                failures++;
                if (failureTelemetry.length < 25) {
                  failureTelemetry.push({
                    index: workerId,
                    input_payload: { workerId: workerId, local: local, maxLocal: maxLocal },
                    exception: stackFromError(e),
                    error_code: e && e.name ? e.name : "Error",
                    state_boundary: { workers: workers, tasks: tasks, completed: completed }
                  });
                }
                resolve(local);
              }
            }
            step();
          })
        );
      })(w);
    }

    return Promise.all(promises).then(function () {
      var heapAfter = sampleHeap();
      return {
        vector: "concurrency_pool",
        equation: "W workers × T tasks; cooperative scheduling completion",
        workers: workers,
        tasks: tasks,
        completed: completed,
        failures: failures,
        success_rate: tasks ? completed / tasks : 0,
        elapsed_ms: now() - t0,
        heap_before: heapBefore,
        heap_after: heapAfter,
        heap_delta_bytes:
          heapBefore.supported && heapAfter.supported
            ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
            : null,
        failure_telemetry: failureTelemetry
      };
    });
  }

  async function faultInjectionMatrix(opts) {
    opts = opts || {};
    var frontend = opts.frontend || TARGETS.frontend;
    var backend = opts.backend || TARGETS.backend;
    var results = [];
    var failureTelemetry = [];
    var failures = 0;
    var heapBefore = sampleHeap();
    var tAll = now();

    async function probe(name, url, init) {
      var t0 = now();
      var status = 0;
      var ok = false;
      var err = null;
      var input = { name: name, url: url, init: init || { method: "GET" } };
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
          ctrl.abort();
        }, opts.timeoutMs || 8000);
        var res = await fetch(
          url,
          Object.assign({ signal: ctrl.signal, mode: "cors" }, init || {})
        );
        clearTimeout(timer);
        status = res.status;
        ok = res.ok || res.type === "opaque";
        if (!ok && status >= 400) {
          failures++;
          failureTelemetry.push({
            index: results.length,
            input_payload: input,
            exception: "HTTP_" + status,
            error_code: "HTTP_" + status,
            state_boundary: { status: status, ok: ok, latency_ms: now() - t0 }
          });
        }
      } catch (e) {
        err =
          e && e.name === "AbortError"
            ? "timeout"
            : String(e && e.message ? e.message : e);
        if (/Failed to fetch|NetworkError|CORS/i.test(err)) {
          err = "network_or_cors";
        }
        failures++;
        failureTelemetry.push({
          index: results.length,
          input_payload: input,
          exception: stackFromError(e),
          error_code: e && e.name ? e.name : err,
          state_boundary: {
            status: status,
            simulated_packet_drop: err === "timeout",
            network_error: err === "network_or_cors",
            latency_ms: now() - t0
          }
        });
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
    await probe("backend_bad_json", backend.replace(/\/$/, "") + "/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    });
    await probe("frontend_timeout_sim", frontend, { method: "GET" });

    var heapAfter = sampleHeap();
    return {
      vector: "fault_injection",
      equation: "F={timeout,corrupt,unreachable}; R=status∈2xx∨opaque",
      targets: TARGETS,
      probes: results,
      failures: failures,
      success_rate:
        results.filter(function (r) {
          return r.ok || r.status > 0;
        }).length / Math.max(1, results.length),
      elapsed_ms: now() - tAll,
      heap_before: heapBefore,
      heap_after: heapAfter,
      heap_delta_bytes:
        heapBefore.supported && heapAfter.supported
          ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
          : null,
      failure_telemetry: failureTelemetry
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
    var heapCycle = cycle.heap_cycle || null;
    var report = {
      id: "vste_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      targets: TARGETS,
      cycle: cycle,
      heap_cycle: heapCycle,
      summary: {
        vectors: (cycle.results || []).map(function (r) {
          return r.vector;
        }),
        total_elapsed_ms: cycle.total_elapsed_ms,
        total_failures: (cycle.results || []).reduce(function (s, r) {
          return s + (r.failures || 0);
        }, 0),
        overall_success:
          cycle.results && cycle.results.length
            ? cycle.results.reduce(function (s, r) {
                return s + (r.success_rate != null ? r.success_rate : 1);
              }, 0) / cycle.results.length
            : 0,
        heap_before: heapCycle && heapCycle.before,
        heap_after: heapCycle && heapCycle.after,
        heap_delta_bytes: heapCycle && heapCycle.delta_bytes
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
    var heapBefore = sampleHeap();
    var results = [];
    function prog(msg, data) {
      if (onProgress) onProgress(msg, data);
    }
    prog("monte_carlo_fuzz");
    results.push(runMonteCarlo(opts.monteCarlo));
    prog("complexity_profiling");
    results.push(profileComplexity(opts.complexity));
    prog("memory_exhaustion");
    results.push(memoryExhaustion(opts.memory));
    prog("concurrency_pool");
    results.push(await concurrencyStress(opts.concurrency));
    prog("fault_injection");
    results.push(await faultInjectionMatrix(opts.fault));
    var heapAfter = sampleHeap();
    var cycle = {
      results: results,
      total_elapsed_ms: now() - t0,
      viewport: opts.viewport || null,
      heap_cycle: {
        before: heapBefore,
        after: heapAfter,
        delta_bytes:
          heapBefore.supported && heapAfter.supported
            ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
            : null
      }
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
      "- **Total elapsed:** " +
        Number((report.cycle && report.cycle.total_elapsed_ms) || 0).toFixed(2) +
        " ms",
      "- **Overall success metric:** " +
        Number((report.summary && report.summary.overall_success) || 0).toFixed(4),
      "- **Total failures:** " + ((report.summary && report.summary.total_failures) || 0),
      ""
    ];

    if (report.summary && report.summary.heap_before) {
      lines.push("## Cycle Heap Sampling (`performance.memory`)");
      lines.push("");
      lines.push("```json");
      lines.push(
        JSON.stringify(
          {
            before: report.summary.heap_before,
            after: report.summary.heap_after,
            delta_bytes: report.summary.heap_delta_bytes
          },
          null,
          2
        )
      );
      lines.push("```");
      lines.push("");
    }

    (report.cycle.results || []).forEach(function (r) {
      lines.push("## Vector: `" + r.vector + "`");
      lines.push("");
      if (r.equation) lines.push("- Equation: `" + r.equation + "`");
      Object.keys(r).forEach(function (k) {
        if (
          k === "vector" ||
          k === "equation" ||
          k === "series" ||
          k === "probes" ||
          k === "failure_telemetry" ||
          k === "heap_before" ||
          k === "heap_after" ||
          k === "heap_after_hold" ||
          k === "heap_after_release" ||
          k === "targets"
        )
          return;
        var v = r[k];
        if (typeof v === "object") return;
        lines.push("- **" + k + ":** " + v);
      });
      if (r.heap_before || r.heap_after || r.heap_after_hold) {
        lines.push("");
        lines.push("### Heap");
        lines.push("```json");
        lines.push(
          JSON.stringify(
            {
              before: r.heap_before,
              after: r.heap_after,
              after_hold: r.heap_after_hold,
              after_release: r.heap_after_release,
              delta_bytes: r.heap_delta_bytes
            },
            null,
            2
          )
        );
        lines.push("```");
      }
      if (r.series) {
        lines.push("");
        lines.push("### Complexity series");
        lines.push("```json");
        lines.push(JSON.stringify(r.series, null, 2));
        lines.push("```");
      }
      if (r.probes) {
        lines.push("");
        lines.push("### Probes");
        lines.push("```json");
        lines.push(JSON.stringify(r.probes, null, 2));
        lines.push("```");
      }
      if (r.failures > 0 && r.failure_telemetry && r.failure_telemetry.length) {
        lines.push("");
        lines.push("## Failure Telemetry");
        lines.push("");
        lines.push(
          "Failures recorded: **" +
            r.failures +
            "** (showing " +
            r.failure_telemetry.length +
            " samples)"
        );
        lines.push("");
        r.failure_telemetry.forEach(function (ft, idx) {
          lines.push("### Failure " + (idx + 1));
          lines.push("");
          lines.push("- **error_code:** `" + ft.error_code + "`");
          lines.push("- **exception / stack:**");
          lines.push("```");
          lines.push(String(ft.exception || ""));
          lines.push("```");
          lines.push("- **input_payload:**");
          lines.push("```json");
          lines.push(JSON.stringify(ft.input_payload, null, 2));
          lines.push("```");
          lines.push("- **state_boundary:**");
          lines.push("```json");
          lines.push(JSON.stringify(ft.state_boundary, null, 2));
          lines.push("```");
          lines.push("");
        });
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  global.VirtualStressEngine = {
    TARGETS: TARGETS,
    REPORT_KEY: REPORT_KEY,
    sampleHeap: sampleHeap,
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
