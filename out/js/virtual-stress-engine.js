/**
 * Virtual Stress Testing Engine — REAL async four-vector pipeline.
 * No short-circuit mocks. Isolated report library: vste-reports-v1.
 */
(function (global) {
  "use strict";

  var TARGETS = {
    frontend: "https://dominiccalandro1991-byte.github.io/snca-codec/",
    backend: "https://nano-cloud-backend.onrender.com"
  };

  var VECTORS = [
    "monte_carlo_fuzz",
    "complexity_profiling",
    "memory_exhaustion",
    "fault_injection"
  ];

  var REPORT_KEY = "vste-reports-v1";
  var MAX_REPORTS = 40;

  function now() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  var HeapTracker = {
    allocated: 0,
    peak: 0,
    track: function (bytes) {
      this.allocated += bytes;
      if (this.allocated > this.peak) this.peak = this.allocated;
    },
    release: function (bytes) {
      this.allocated = Math.max(0, this.allocated - bytes);
    },
    reset: function () {
      this.allocated = 0;
      this.peak = 0;
    }
  };

  function sampleHeap() {
    var mem =
      typeof performance !== "undefined" && performance.memory
        ? performance.memory
        : null;
    if (mem && typeof mem.usedJSHeapSize === "number") {
      return {
        supported: true,
        source: "performance.memory",
        usedJSHeapSize: mem.usedJSHeapSize,
        totalJSHeapSize: mem.totalJSHeapSize,
        jsHeapSizeLimit: mem.jsHeapSizeLimit,
        polyfill_allocated: HeapTracker.allocated,
        polyfill_peak: HeapTracker.peak
      };
    }
    return {
      supported: true,
      source: "polyfill_arraybuffer_tracker",
      usedJSHeapSize: HeapTracker.allocated,
      totalJSHeapSize: HeapTracker.peak,
      jsHeapSizeLimit: null,
      polyfill_allocated: HeapTracker.allocated,
      polyfill_peak: HeapTracker.peak
    };
  }

  function stackFromError(err) {
    if (!err) return "unknown";
    if (typeof err === "string") return err;
    return String(err.stack || err.message || err);
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

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
  }

  function createReportBuilder() {
    var results = [];
    return {
      addVectorResult: function (vector, vectorResult) {
        var copy = Object.assign({}, vectorResult);
        copy.vector = vector;
        results.push(copy);
      },
      getResults: function () {
        return results.slice();
      }
    };
  }

  /** Validate / fuzz boundary payloads against a real input validation function */
  /**
   * Defensive payload validation — returns boolean, never throws on bad input shape.
   */
  function validatePayload(input) {
    // Guard 1: Defensive type and nullish check
    if (!input || typeof input !== "object") {
      return false;
    }
    var boundary = input.boundary;
    var nullish = input.nullish;
    var payload = input.payload;

    // Guard 2: Safe boundary parsing and clamping policy
    var safeBoundary = Number.isFinite(boundary) ? boundary : 0;
    if (safeBoundary < 0 || safeBoundary >= Number.MAX_SAFE_INTEGER) {
      return false; // explicit validation failure instead of RangeError
    }

    // Guard 3: Nullish string handling (null means rejected; non-string non-null rejected)
    if (nullish !== null && typeof nullish !== "string") {
      return false;
    }
    if (nullish === null) {
      return false;
    }

    // Guard 4: Sub-payload validation
    if (!payload || typeof payload.x !== "number" || typeof payload.y !== "number") {
      return false;
    }

    return true;
  }

  async function executeMonteCarloFuzz() {
    var n = 800;
    var rng = mulberry32(Date.now() % 1e9);
    var heapBefore = sampleHeap();
    var failures = 0;
    var latencies = [];
    var failureTelemetry = [];

    for (var i = 0; i < n; i++) {
      var v = {
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
      };
      var s = now();
      var ok = validatePayload(v);
      if (!ok) {
        failures++;
        if (failureTelemetry.length < 30) {
          failureTelemetry.push({
            index: i,
            input_payload: v,
            exception: "validatePayload_returned_false",
            error_code: "ValidationFailure",
            state_boundary: {
              boundary: v.boundary,
              nullish: v.nullish,
              u: v.u,
              safeBoundary: Number.isFinite(v.boundary) ? v.boundary : 0
            }
          });
        }
      }
      latencies.push(now() - s);
      // yield occasionally so total wall time is real async work
      if (i % 100 === 0) await Promise.resolve();
    }
    latencies.sort(function (a, b) {
      return a - b;
    });
    var heapAfter = sampleHeap();
    return {
      equation: "validatePayload(P); P boundary fuzz over N samples",
      samples: n,
      failures: failures,
      success_rate: 1 - failures / n,
      latency_p50: percentile(latencies, 0.5),
      latency_p95: percentile(latencies, 0.95),
      latency_p99: percentile(latencies, 0.99),
      heap_before: heapBefore,
      heap_after: heapAfter,
      failure_telemetry: failureTelemetry
    };
  }

  async function executeComplexityProfiling() {
    var sizes = [10, 100, 1000];
    var heapBefore = sampleHeap();
    var series = [];
    var failureTelemetry = [];
    var failures = 0;

    function work(n) {
      var s = 0;
      for (var i = 0; i < n; i++) {
        for (var j = 0; j < Math.min(n, 250); j++) {
          s += (i * j + i) % 7;
        }
      }
      return s;
    }

    for (var si = 0; si < sizes.length; si++) {
      var n = sizes[si];
      try {
        var t0 = now();
        // Scale iterations so N=1000 is measurable
        var reps = n <= 10 ? 5000 : n <= 100 ? 200 : 20;
        var acc = 0;
        for (var r = 0; r < reps; r++) acc += work(n);
        var elapsed = now() - t0;
        series.push({
          n: n,
          reps: reps,
          t_ms: elapsed,
          t_per_rep_ms: elapsed / reps,
          checksum: acc % 1000003
        });
        await Promise.resolve();
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
    }

    var bound = "O(N²)";
    if (series.length >= 2) {
      var a = series[0];
      var b = series[series.length - 1];
      var timeRatio = b.t_per_rep_ms / Math.max(1e-9, a.t_per_rep_ms);
      var nRatio = b.n / a.n;
      if (timeRatio > nRatio * nRatio * 0.3) bound = "O(N²)";
      else if (timeRatio > nRatio * 0.5) bound = "O(N)";
      else bound = "O(1)–O(N)";
    }

    return {
      equation: "T(N) for N∈{10,100,1000}; empirical growth classification",
      series: series,
      empirical_bound: bound,
      failures: failures,
      success_rate: sizes.length ? 1 - failures / sizes.length : 0,
      heap_before: heapBefore,
      heap_after: sampleHeap(),
      failure_telemetry: failureTelemetry
    };
  }

  async function executeMemoryExhaustion() {
    var chunks = 48;
    var size = 256 * 1024;
    var held = [];
    var heapBefore = sampleHeap();
    var allocated = 0;
    var failures = 0;
    var failureTelemetry = [];
    var peak = HeapTracker.peak;

    for (var i = 0; i < chunks; i++) {
      try {
        var buf = new Uint8Array(size);
        for (var k = 0; k < 64; k++) buf[k * 1024] = (i + k) & 255;
        held.push(buf);
        allocated += size;
        HeapTracker.track(size);
        if (HeapTracker.allocated > peak) peak = HeapTracker.allocated;
        if (i % 8 === 0) await Promise.resolve();
      } catch (e) {
        failures++;
        failureTelemetry.push({
          index: i,
          input_payload: { chunk: i, chunk_bytes: size, allocated_so_far: allocated },
          exception: stackFromError(e),
          error_code: e && e.name ? e.name : "AllocError",
          state_boundary: { heap: sampleHeap(), polyfill_peak: HeapTracker.peak }
        });
        break;
      }
    }

    var heapAfterHold = sampleHeap();
    var released = allocated;
    held.length = 0;
    held = null;
    HeapTracker.release(released);
    await Promise.resolve();
    var heapAfterRelease = sampleHeap();

    return {
      equation: "A=Σ Uint8Array(chunk); track polyfill_arraybuffer_tracker; release",
      chunks: chunks,
      chunk_bytes: size,
      allocated_bytes: allocated,
      failures: failures,
      success_rate: failures ? 0.5 : 1,
      heap_before: heapBefore,
      heap_after_hold: heapAfterHold,
      heap_after_release: heapAfterRelease,
      polyfill_peak: peak,
      leak_proxy:
        heapAfterRelease.usedJSHeapSize != null && heapBefore.usedJSHeapSize != null
          ? heapAfterRelease.usedJSHeapSize - heapBefore.usedJSHeapSize
          : HeapTracker.allocated,
      failure_telemetry: failureTelemetry
    };
  }

  async function measureNetworkRtt(url, samples, timeoutMs) {
    samples = Math.min(Math.max(samples || 9, 3), 20);
    var latencies = [];
    var errors = [];
    for (var i = 0; i < samples; i++) {
      var t0 = now();
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
          ctrl.abort();
        }, timeoutMs || 10000);
        await fetch(url, {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          signal: ctrl.signal
        });
        clearTimeout(timer);
        latencies.push(now() - t0);
      } catch (e) {
        latencies.push(now() - t0);
        errors.push({
          sample: i,
          latency_ms: latencies[latencies.length - 1],
          exception: stackFromError(e),
          error_code: e && e.name ? e.name : "fetch_error"
        });
      }
    }
    var sorted = latencies.slice().sort(function (a, b) {
      return a - b;
    });
    return {
      url: url,
      samples: samples,
      latencies_ms: latencies,
      latency_p50: percentile(sorted, 0.5),
      latency_p95: percentile(sorted, 0.95),
      latency_p99: percentile(sorted, 0.99),
      error_count: errors.length,
      errors: errors.slice(0, 10)
    };
  }

  async function executeFaultInjection(frontendUrl, backendUrl) {
    var frontend = frontendUrl || TARGETS.frontend;
    var backend = backendUrl || TARGETS.backend;
    var heapBefore = sampleHeap();
    var failureTelemetry = [];
    var failures = 0;
    var probes = [];

    var feRtt = await measureNetworkRtt(frontend, 9, 10000);
    var beRtt = await measureNetworkRtt(backend, 9, 10000);
    var beHealth = await measureNetworkRtt(backend.replace(/\/$/, "") + "/health", 7, 10000);

    /**
     * Structured network probe — never throws; malformed bodies / transport failures return error object.
     */
    async function executeFaultProbe(probe) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
          ctrl.abort();
        }, 10000);
        var response = await fetch(
          probe.url,
          Object.assign(
            { signal: ctrl.signal, mode: "cors", cache: "no-store" },
            probe.init || { method: "GET" }
          )
        );
        clearTimeout(timer);
        return {
          status: response.status,
          ok: response.ok || response.type === "opaque",
          error: null
        };
      } catch (err) {
        var msg =
          err && err.name === "AbortError"
            ? "timeout"
            : err && err.message
              ? err.message
              : "Network transport failure";
        if (/Failed to fetch|NetworkError|CORS/i.test(msg)) msg = "network_or_cors";
        return {
          status: 0,
          ok: false,
          error: msg
        };
      }
    }

    async function probe(name, url, init) {
      var t0 = now();
      var input = { name: name, url: url, init: init || { method: "GET" } };
      var result = await executeFaultProbe({ url: url, init: init || { method: "GET" } });
      if (!result.ok) {
        failures++;
        failureTelemetry.push({
          index: probes.length,
          input_payload: input,
          exception: result.error || ("HTTP_" + result.status),
          error_code: result.error || ("HTTP_" + result.status),
          state_boundary: {
            status: result.status,
            latency_ms: now() - t0,
            network_error: !!result.error
          }
        });
      }
      probes.push({
        name: name,
        url: url,
        status: result.status,
        ok: result.ok,
        error: result.error,
        latency_ms: now() - t0
      });
    }

    await probe("frontend_get", frontend, { method: "GET" });
    await probe("backend_get", backend, { method: "GET" });
    await probe("backend_health", backend.replace(/\/$/, "") + "/health", {
      method: "GET"
    });
    await probe("backend_bad_json", backend.replace(/\/$/, "") + "/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    });

    return {
      equation: "await fetch(targets); RTT percentiles; fault probes",
      targets: { frontend: frontend, backend: backend },
      network_rtt: {
        frontend: feRtt,
        backend: beRtt,
        backend_health: beHealth
      },
      latency_p50: feRtt.latency_p50,
      latency_p95: feRtt.latency_p95,
      latency_p99: feRtt.latency_p99,
      backend_latency_p50: beRtt.latency_p50,
      backend_latency_p95: beRtt.latency_p95,
      backend_latency_p99: beRtt.latency_p99,
      probes: probes,
      failures: failures,
      success_rate:
        probes.filter(function (p) {
          return p.ok || p.status > 0;
        }).length / Math.max(1, probes.length),
      heap_before: heapBefore,
      heap_after: sampleHeap(),
      failure_telemetry: failureTelemetry
    };
  }

  async function executeVector(vector, targetFrontendUrl, targetBackendUrl) {
    switch (vector) {
      case "monte_carlo_fuzz":
        return executeMonteCarloFuzz();
      case "complexity_profiling":
        return executeComplexityProfiling();
      case "memory_exhaustion":
        return executeMemoryExhaustion();
      case "fault_injection":
        return executeFaultInjection(targetFrontendUrl, targetBackendUrl);
      default:
        throw new Error("unknown_vector:" + vector);
    }
  }

  function loadReports() {
    try {
      if (typeof localStorage === "undefined") return [];
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
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(REPORT_KEY, JSON.stringify(arr.slice(0, MAX_REPORTS)));
    } catch (e) {}
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
      lines.push("## Cycle Heap Sampling");
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
      lines.push("## Vector: " + r.vector);
      lines.push("");
      if (r.equation) lines.push("- Equation: `" + r.equation + "`");
      if (r.elapsed_ms != null) lines.push("- **elapsed_ms:** " + r.elapsed_ms);
      Object.keys(r).forEach(function (k) {
        if (
          [
            "vector",
            "equation",
            "series",
            "probes",
            "failure_telemetry",
            "heap_before",
            "heap_after",
            "heap_after_hold",
            "heap_after_release",
            "targets",
            "network_rtt",
            "elapsed_ms"
          ].indexOf(k) !== -1
        )
          return;
        if (typeof r[k] === "object") return;
        lines.push("- **" + k + ":** " + r[k]);
      });
      if (r.network_rtt) {
        lines.push("");
        lines.push("### Network RTT (real fetch samples)");
        lines.push("```json");
        lines.push(JSON.stringify(r.network_rtt, null, 2));
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
        vector_count: (cycle.results || []).length,
        vectors_complete: (cycle.results || []).map(function (r) {
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
        heap_before: cycle.heap_cycle && cycle.heap_cycle.before,
        heap_after: cycle.heap_cycle && cycle.heap_cycle.after,
        heap_delta_bytes: cycle.heap_cycle && cycle.heap_cycle.delta_bytes
      }
    };
    var lib = loadReports();
    lib.unshift(report);
    saveReports(lib);
    return report;
  }

  /**
   * Explicit async sequence over VECTORS — no short-circuit.
   */
  async function runFullStressCycle(opts, onProgress) {
    opts = opts || {};
    var targetFrontendUrl = opts.frontend || TARGETS.frontend;
    var targetBackendUrl = opts.backend || TARGETS.backend;
    var report = createReportBuilder();
    HeapTracker.reset();
    var heapBefore = sampleHeap();
    var cycleStart = now();

    for (var vi = 0; vi < VECTORS.length; vi++) {
      var vector = VECTORS[vi];
      if (onProgress) onProgress(vector);
      var startTime = performance.now();
      var vectorResult;
      try {
        vectorResult = await executeVector(vector, targetFrontendUrl, targetBackendUrl);
      } catch (e) {
        vectorResult = {
          failures: 1,
          success_rate: 0,
          failure_telemetry: [
            {
              index: 0,
              input_payload: { vector: vector },
              exception: stackFromError(e),
              error_code: e && e.name ? e.name : "VectorError",
              state_boundary: {}
            }
          ]
        };
      }
      var endTime = performance.now();
      vectorResult.elapsed_ms = endTime - startTime;
      report.addVectorResult(vector, vectorResult);
      if (onProgress) onProgress(vector + "_done", vectorResult);
    }

    var heapAfter = sampleHeap();
    var cycle = {
      results: report.getResults(),
      vector_count: report.getResults().length,
      vectors_complete: report.getResults().map(function (r) {
        return r.vector;
      }),
      total_elapsed_ms: now() - cycleStart,
      viewport: opts.viewport || null,
      heap_cycle: {
        before: heapBefore,
        after: heapAfter,
        delta_bytes:
          heapBefore.usedJSHeapSize != null && heapAfter.usedJSHeapSize != null
            ? heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize
            : null,
        polyfill: { allocated: HeapTracker.allocated, peak: HeapTracker.peak }
      }
    };
    var finalReport = synthesizeReport(cycle);
    if (onProgress) onProgress("done", finalReport);
    return finalReport;
  }

  // Back-compat alias
  async function runFullCycle(opts, onProgress) {
    return runFullStressCycle(opts, onProgress);
  }

  global.VirtualStressEngine = {
    TARGETS: TARGETS,
    VECTORS: VECTORS.slice(),
    REPORT_KEY: REPORT_KEY,
    sampleHeap: sampleHeap,
    executeVector: executeVector,
    runFullStressCycle: runFullStressCycle,
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

// Node/CommonJS export for pre-commit verification gate
if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.VirtualStressEngine;
}
