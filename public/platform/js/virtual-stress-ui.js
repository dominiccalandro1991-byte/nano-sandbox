/**
 * Virtual Stress Tester UI — terminal card lifecycle + auto report routing.
 */
(function (global) {
  "use strict";

  var PRESETS = {
    mobile: { label: "Mobile (390×844)", w: 390, h: 844 },
    desktop: { label: "Desktop (1280×720)", w: 1280, h: 720 },
    full: { label: "Full (100%)", w: null, h: null },
    custom: { label: "Custom", w: 1280, h: 720 }
  };

  var state = { mode: "desktop", w: 1280, h: 720 };
  var root = null;
  var refs = {};
  var lastMarkdown = "";
  var lastReport = null;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function eng() {
    return global.VirtualStressEngine;
  }

  function syncPresetButtons() {
    if (!refs.toggles) return;
    refs.toggles.querySelectorAll("[data-preset]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-preset") === state.mode);
    });
  }

  function syncInputsFromState() {
    if (!refs.cw || !refs.ch) return;
    if (state.mode === "full" && refs.canvasWrap) {
      refs.cw.value = Math.max(200, refs.canvasWrap.clientWidth - 16);
      refs.ch.value = Math.max(200, refs.canvasWrap.clientHeight - 16);
      state.w = Number(refs.cw.value);
      state.h = Number(refs.ch.value);
    } else {
      refs.cw.value = state.w;
      refs.ch.value = state.h;
    }
  }

  function applyViewportScale() {
    if (!refs.frame || !refs.canvasWrap) return;
    var cw = refs.canvasWrap.clientWidth - 16;
    var ch = refs.canvasWrap.clientHeight - 16;
    var tw = state.w;
    var th = state.h;
    if (state.mode === "full") {
      tw = Math.max(200, cw);
      th = Math.max(200, ch);
      state.w = tw;
      state.h = th;
    }
    var S = Math.min(cw / tw, ch / th, 1);
    if (!isFinite(S) || S <= 0) S = 1;
    refs.frame.style.width = tw + "px";
    refs.frame.style.height = th + "px";
    refs.frame.style.transform = "scale(" + S + ")";
    refs.frame.style.transformOrigin = "top left";
    refs.frame.dataset.scale = String(S);
    if (refs.scaleLabel) {
      refs.scaleLabel.textContent =
        (PRESETS[state.mode] ? PRESETS[state.mode].label : state.mode) +
        " · " +
        tw +
        "×" +
        th +
        " · S=" +
        S.toFixed(3);
    }
    syncPresetButtons();
  }

  function setPreset(mode) {
    if (!PRESETS[mode]) mode = "desktop";
    state.mode = mode;
    if (mode !== "full" && mode !== "custom") {
      state.w = PRESETS[mode].w;
      state.h = PRESETS[mode].h;
    } else if (mode === "custom") {
      state.w = Number(refs.cw && refs.cw.value) || state.w || 1280;
      state.h = Number(refs.ch && refs.ch.value) || state.h || 720;
    }
    syncInputsFromState();
    applyViewportScale();
  }

  function onManualDimension() {
    state.mode = "custom";
    state.w = Math.max(200, Number(refs.cw.value) || 1280);
    state.h = Math.max(200, Number(refs.ch.value) || 720);
    refs.cw.value = state.w;
    refs.ch.value = state.h;
    syncPresetButtons();
    applyViewportScale();
  }

  function showTerminal(text) {
    if (!refs.terminalCard || !refs.terminalOut) return;
    refs.terminalCard.style.display = "";
    refs.terminalOut.textContent = text || "";
  }

  function hideTerminal() {
    if (refs.terminalOut) refs.terminalOut.textContent = "";
    if (refs.terminalCard) refs.terminalCard.style.display = "none";
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
  }

  function generateMarkdownReport(result) {
    var e = eng();
    if (!e) return "";
    if (result && result.id && result.cycle) {
      return e.reportToMarkdown(result);
    }
    // Single-vector partial → synthesize minimal report
    if (result && result.vector) {
      var report = e.synthesizeReport({
        results: [result],
        total_elapsed_ms: result.elapsed_ms || 0,
        vectors_complete: [result.vector],
        heap_cycle: {
          before: result.heap_before || null,
          after: result.heap_after || result.heap_after_release || null,
          delta_bytes: null
        }
      });
      return e.reportToMarkdown(report);
    }
    return String(result || "");
  }

  function appendLibraryItem(report, md) {
    var list = refs.libraryList;
    if (!list) return;
    var empty = list.querySelector(".vste-lib-empty");
    if (empty) empty.remove();

    var id = (report && report.id) || "inline_" + Date.now().toString(36);
    var card = el("div", "vste-report-card");
    card.setAttribute("data-report-id", id);
    card.innerHTML =
      "<div><code>" +
      id +
      "</code><br/><span class=\"muted\">" +
      ((report && report.createdAt) || new Date().toISOString()) +
      "</span></div>";
    var actions = el("div", "vste-report-actions");
    function btn(label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ghost-btn";
      b.textContent = label;
      b.onclick = fn;
      return b;
    }
    actions.appendChild(
      btn("Copy MD", function () {
        if (navigator.clipboard) navigator.clipboard.writeText(md);
      })
    );
    actions.appendChild(
      btn("Download MD", function () {
        downloadText(id + ".md", md, "text/markdown;charset=utf-8");
      })
    );
    actions.appendChild(
      btn("Download JSON", function () {
        downloadText(id + ".json", JSON.stringify(report || { md: md }, null, 2), "application/json");
      })
    );
    actions.appendChild(
      btn("Delete", function () {
        if (eng() && report && report.id) eng().deleteReport(report.id);
        card.remove();
        if (!list.querySelector(".vste-report-card")) {
          list.appendChild(el("p", "muted vste-lib-empty", "No reports yet."));
        }
      })
    );
    card.appendChild(actions);
    list.insertBefore(card, list.firstChild);
  }

  function renderReportLibrary() {
    var list = refs.libraryList;
    if (!list || !eng()) return;
    list.innerHTML = "";
    var reports = eng().loadReports();
    if (!reports.length) {
      list.appendChild(el("p", "muted vste-lib-empty", "No reports yet. Run a stress cycle."));
      return;
    }
    reports.forEach(function (r) {
      appendLibraryItem(r, eng().reportToMarkdown(r));
    });
  }

  function pushToLibrary(report, md) {
    lastReport = report;
    lastMarkdown = md || generateMarkdownReport(report);
    appendLibraryItem(report, lastMarkdown);
    if (refs.librarySection) {
      try {
        refs.librarySection.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        refs.librarySection.scrollIntoView(true);
      }
    }
    hideTerminal();
  }

  function onCycleComplete(report, liveText) {
    showTerminal(liveText || "Cycle complete.");
    var md = generateMarkdownReport(report);
    lastMarkdown = md;
    lastReport = report;
    // Auto-push to isolated report library
    pushToLibrary(report, md);
  }

  function wireTerminalActions() {
    var copyBtn = document.getElementById("btn-copy-md");
    var pushBtn = document.getElementById("btn-push-library");
    var clearBtn = document.getElementById("btn-clear-terminal");
    if (copyBtn) {
      copyBtn.onclick = function () {
        var text =
          lastMarkdown ||
          (refs.terminalOut && refs.terminalOut.textContent) ||
          "";
        if (navigator.clipboard) navigator.clipboard.writeText(text);
      };
    }
    if (pushBtn) {
      pushBtn.onclick = function () {
        var md =
          lastMarkdown ||
          (refs.terminalOut && refs.terminalOut.textContent) ||
          "";
        if (!md) return;
        var report =
          lastReport ||
          {
            id: "manual_" + Date.now().toString(36),
            createdAt: new Date().toISOString(),
            cycle: { results: [] }
          };
        pushToLibrary(report, md);
      };
    }
    if (clearBtn) {
      clearBtn.onclick = function () {
        hideTerminal();
      };
    }
  }

  function runUISmokeTest() {
    var checks = [];
    function assert(name, pass, detail) {
      checks.push({ name: name, pass: !!pass, detail: detail || "" });
    }
    assert("terminal_card", !!document.getElementById("stress-terminal-card"), "");
    assert("terminal_output", !!document.getElementById("stress-terminal-output"), "");
    assert("btn_copy", !!document.getElementById("btn-copy-md"), "");
    assert("btn_push", !!document.getElementById("btn-push-library"), "");
    assert("btn_clear", !!document.getElementById("btn-clear-terminal"), "");
    assert("btn_run_full", !!document.getElementById("btn-run-full"), "");
    assert("btn_run_fuzz", !!document.getElementById("btn-run-fuzz"), "");
    assert("btn_run_fault", !!document.getElementById("btn-run-fault"), "");
    assert("btn_run_smoke", !!document.getElementById("btn-run-smoke"), "");
    assert("report_library_list", !!document.getElementById("report-library-list"), "");

    showTerminal("Smoke running…");
    assert("terminal_visible", refs.terminalCard.style.display !== "none", refs.terminalCard.style.display);

    // clear path
    document.getElementById("btn-clear-terminal").click();
    assert("clear_hides", refs.terminalCard.style.display === "none", refs.terminalCard.style.display);

    // state sync
    setPreset("mobile");
    assert("sync_mobile", state.w === 390 && state.h === 844, state.w + "x" + state.h);
    setPreset("desktop");

    var ok = checks.every(function (c) {
      return c.pass;
    });
    var summary = { ok: ok, checks: checks, at: new Date().toISOString() };
    try {
      console[ok ? "log" : "warn"]("[VSTE runUISmokeTest]", summary);
    } catch (e) {}
    return summary;
  }

  async function handleRunFull() {
    var e = eng();
    if (!e) return;
    showTerminal("Running full stress cycle (4 vectors)…");
    var viewport = {
      mode: state.mode,
      w: state.w,
      h: state.h,
      S: Number(refs.frame && refs.frame.dataset.scale)
    };
    try {
      var report = await e.runFullStressCycle({ viewport: viewport }, function (stage) {
        showTerminal("Running… " + stage);
      });
      var md = generateMarkdownReport(report);
      showTerminal(
        "Ready.\nvectors: " +
          JSON.stringify(report.summary.vectors_complete) +
          "\n" +
          JSON.stringify(report.summary, null, 2)
      );
      onCycleComplete(report, refs.terminalOut.textContent);
    } catch (err) {
      showTerminal("Error: " + (err && err.message ? err.message : err));
    }
  }

  async function handleRunFuzz() {
    var e = eng();
    if (!e) return;
    showTerminal("Running monte_carlo_fuzz…");
    try {
      var t0 = performance.now();
      var vectorResult = await e.executeVector(
        "monte_carlo_fuzz",
        e.TARGETS.frontend,
        e.TARGETS.backend
      );
      vectorResult.elapsed_ms = performance.now() - t0;
      vectorResult.vector = "monte_carlo_fuzz";
      var report = e.synthesizeReport({
        results: [vectorResult],
        total_elapsed_ms: vectorResult.elapsed_ms,
        vectors_complete: ["monte_carlo_fuzz"]
      });
      showTerminal("Ready.\n" + JSON.stringify({ failures: vectorResult.failures, elapsed_ms: vectorResult.elapsed_ms }, null, 2));
      onCycleComplete(report, refs.terminalOut.textContent);
    } catch (err) {
      showTerminal("Error: " + (err && err.message ? err.message : err));
    }
  }

  async function handleRunFault() {
    var e = eng();
    if (!e) return;
    showTerminal("Running fault_injection (live fetch)…");
    try {
      var t0 = performance.now();
      var vectorResult = await e.executeVector(
        "fault_injection",
        e.TARGETS.frontend,
        e.TARGETS.backend
      );
      vectorResult.elapsed_ms = performance.now() - t0;
      vectorResult.vector = "fault_injection";
      var report = e.synthesizeReport({
        results: [vectorResult],
        total_elapsed_ms: vectorResult.elapsed_ms,
        vectors_complete: ["fault_injection"]
      });
      showTerminal(
        "Ready.\nRTT p50/p95/p99: " +
          vectorResult.latency_p50 +
          " / " +
          vectorResult.latency_p95 +
          " / " +
          vectorResult.latency_p99
      );
      onCycleComplete(report, refs.terminalOut.textContent);
    } catch (err) {
      showTerminal("Error: " + (err && err.message ? err.message : err));
    }
  }

  function handleRunSmoke() {
    var res = runUISmokeTest();
    var lines =
      (res.ok ? "SMOKE PASS" : "SMOKE FAIL") +
      "\n" +
      res.checks
        .map(function (c) {
          return (c.pass ? "PASS" : "FAIL") + " · " + c.name + (c.detail ? " — " + c.detail : "");
        })
        .join("\n");
    showTerminal(lines);
    // Smoke also routes a small structured note into library
    var md =
      "# UI Smoke Test\n\n```\n" + lines + "\n```\n";
    lastMarkdown = md;
    pushToLibrary(
      {
        id: "smoke_" + Date.now().toString(36),
        createdAt: new Date().toISOString(),
        cycle: { results: [], smoke: res }
      },
      md
    );
  }

  function mount(container) {
    root = container;
    var e = eng();
    root.innerHTML = "";
    var panel = el("div", "vste-dashboard");

    panel.appendChild(
      el(
        "header",
        "ws-head",
        "<h1>Virtual Stress Testing Engine</h1>" +
          '<p class="muted">Multi-vector stress · isolated report library · adaptive viewport</p>'
      )
    );

    var targets = el("div", "vste-targets");
    targets.innerHTML =
      '<div class="vste-target-row"><span class="lbl">Frontend</span>' +
      '<code class="vste-uri-badge">' +
      (e ? e.TARGETS.frontend : "") +
      "</code></div>" +
      '<div class="vste-target-row"><span class="lbl">Backend</span>' +
      '<code class="vste-uri-badge">' +
      (e ? e.TARGETS.backend : "") +
      "</code></div>";
    panel.appendChild(targets);

    var toggles = el("div", "vste-viewport-toggles");
    Object.keys(PRESETS).forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ghost-btn";
      b.setAttribute("data-preset", m);
      b.textContent = PRESETS[m].label;
      b.onclick = function () {
        setPreset(m);
      };
      toggles.appendChild(b);
    });
    panel.appendChild(toggles);
    refs.toggles = toggles;

    var customRow = el("div", "vste-custom-dim");
    customRow.innerHTML =
      '<label>W <input id="vste-cw" type="number" value="1280" min="200" max="4000"/></label>' +
      '<label>H <input id="vste-ch" type="number" value="720" min="200" max="4000"/></label>';
    panel.appendChild(customRow);
    refs.cw = customRow.querySelector("#vste-cw");
    refs.ch = customRow.querySelector("#vste-ch");
    refs.cw.addEventListener("input", onManualDimension);
    refs.ch.addEventListener("input", onManualDimension);

    var canvasWrap = el("div", "vste-canvas-wrap");
    var scaleLabel = el("div", "vste-scale-label muted", "scale");
    canvasWrap.appendChild(scaleLabel);
    var frame = el("div", "vste-frame");
    frame.innerHTML =
      '<iframe id="vste-iframe" title="Stress target preview" sandbox="allow-scripts allow-same-origin allow-forms" src="' +
      (e ? e.TARGETS.frontend : "about:blank") +
      '"></iframe>';
    canvasWrap.appendChild(frame);
    panel.appendChild(canvasWrap);
    refs.canvasWrap = canvasWrap;
    refs.frame = frame;
    refs.scaleLabel = scaleLabel;

    var controls = el("div", "vste-controls");
    controls.innerHTML =
      '<button type="button" class="primary-btn" id="btn-run-full">Run Full Stress Cycle</button>' +
      '<button type="button" class="ghost-btn" id="btn-run-fuzz">Monte Carlo only</button>' +
      '<button type="button" class="ghost-btn" id="btn-run-fault">Fault injection only</button>' +
      '<button type="button" class="ghost-btn" id="btn-run-smoke">Run UI Smoke Test</button>';
    panel.appendChild(controls);

    // Terminal card with lifecycle controls
    var terminalCard = el("div", "terminal-card");
    terminalCard.id = "stress-terminal-card";
    terminalCard.style.display = "none";
    terminalCard.innerHTML =
      '<div class="terminal-header">' +
      '<span class="terminal-title">Execution Telemetry Output</span>' +
      '<div class="terminal-actions">' +
      '<button type="button" id="btn-copy-md" class="btn-sm">Copy MD</button>' +
      '<button type="button" id="btn-push-library" class="btn-sm btn-primary">Push to Library</button>' +
      '<button type="button" id="btn-clear-terminal" class="btn-sm btn-danger">Delete / Clear</button>' +
      "</div></div>" +
      '<pre id="stress-terminal-output"></pre>';
    panel.appendChild(terminalCard);
    refs.terminalCard = terminalCard;
    refs.terminalOut = terminalCard.querySelector("#stress-terminal-output");

    var libSection = el("div", "vste-report-library");
    libSection.id = "report-library-section";
    libSection.innerHTML =
      '<div class="vste-lib-head"><strong>Stress Test Report Library</strong> <span class="muted">isolated</span></div>';
    var list = el("div", "vste-report-library-list");
    list.id = "report-library-list";
    libSection.appendChild(list);
    panel.appendChild(libSection);
    refs.librarySection = libSection;
    refs.libraryList = list;

    root.appendChild(panel);
    wireTerminalActions();
    window.addEventListener("resize", applyViewportScale);
    setPreset("desktop");
    renderReportLibrary();

    document.getElementById("btn-run-full").onclick = function () {
      handleRunFull();
    };
    document.getElementById("btn-run-fuzz").onclick = function () {
      handleRunFuzz();
    };
    document.getElementById("btn-run-fault").onclick = function () {
      handleRunFault();
    };
    document.getElementById("btn-run-smoke").onclick = function () {
      handleRunSmoke();
    };
  }

  global.VirtualStressUI = {
    mount: mount,
    runUISmokeTest: runUISmokeTest,
    getViewportState: function () {
      return { mode: state.mode, w: state.w, h: state.h };
    },
    // Exposed for integration tests
    _handlers: {
      handleRunFull: handleRunFull,
      handleRunFuzz: handleRunFuzz,
      handleRunFault: handleRunFault,
      handleRunSmoke: handleRunSmoke
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
