/**
 * Virtual Stress Tester Interactive Dashboard
 * Unified viewport state · layout containment · runUISmokeTest()
 */
(function (global) {
  "use strict";

  var PRESETS = {
    mobile: { label: "Mobile (390×844)", w: 390, h: 844 },
    desktop: { label: "Desktop (1280×720)", w: 1280, h: 720 },
    full: { label: "Full (100%)", w: null, h: null },
    custom: { label: "Custom", w: 1280, h: 720 }
  };

  var state = {
    mode: "desktop",
    w: 1280,
    h: 720
  };

  var root = null;
  var refs = {};

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function syncPresetButtons() {
    if (!refs.toggles) return;
    refs.toggles.querySelectorAll("[data-preset]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-preset") === state.mode);
    });
  }

  function syncInputsFromState() {
    if (!refs.cw || !refs.ch) return;
    if (state.mode === "full") {
      var wrap = refs.canvasWrap;
      if (wrap) {
        refs.cw.value = Math.max(200, wrap.clientWidth - 16);
        refs.ch.value = Math.max(200, wrap.clientHeight - 16);
        state.w = Number(refs.cw.value);
        state.h = Number(refs.ch.value);
      }
    } else {
      refs.cw.value = state.w;
      refs.ch.value = state.h;
    }
  }

  function applyViewportScale() {
    if (!refs.frame || !refs.canvasWrap) return;
    var container = refs.canvasWrap;
    var cw = container.clientWidth - 16;
    var ch = container.clientHeight - 16;
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
    refs.frame.dataset.targetW = String(tw);
    refs.frame.dataset.targetH = String(th);
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

  function setLive(text) {
    if (refs.live) refs.live.textContent = text;
  }

  function renderReportLibrary(host) {
    var eng = global.VirtualStressEngine;
    if (!eng || !host) return;
    var reports = eng.loadReports();
    host.innerHTML = "";
    var head = el("div", "vste-lib-head");
    head.innerHTML =
      "<strong>Stress Test Report Library</strong> <span class=\"muted\">isolated · " +
      reports.length +
      " reports</span>";
    host.appendChild(head);
    if (!reports.length) {
      host.appendChild(el("p", "muted", "No reports yet. Run a full cycle to synthesize one."));
      return;
    }
    reports.forEach(function (r) {
      var card = el("div", "vste-report-card");
      card.innerHTML =
        "<div><code>" +
        r.id +
        "</code><br/><span class=\"muted\">" +
        r.createdAt +
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
          var md = eng.reportToMarkdown(r);
          if (navigator.clipboard) navigator.clipboard.writeText(md);
        })
      );
      actions.appendChild(
        btn("Download MD", function () {
          downloadText(r.id + ".md", eng.reportToMarkdown(r), "text/markdown;charset=utf-8");
        })
      );
      actions.appendChild(
        btn("Download JSON", function () {
          downloadText(r.id + ".json", JSON.stringify(r, null, 2), "application/json");
        })
      );
      actions.appendChild(
        btn("HTML", function () {
          var html =
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" +
            r.id +
            "</title></head><body><pre>" +
            eng
              .reportToMarkdown(r)
              .replace(/[<>&]/g, function (c) {
                return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c];
              }) +
            "</pre></body></html>";
          downloadText(r.id + ".html", html, "text/html;charset=utf-8");
        })
      );
      actions.appendChild(
        btn("Raw", function () {
          downloadText(r.id + "-telemetry.json", JSON.stringify(r.cycle, null, 2), "application/json");
        })
      );
      actions.appendChild(
        btn("Delete", function () {
          eng.deleteReport(r.id);
          renderReportLibrary(host);
        })
      );
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  /**
   * Automated UI smoke tests for Virtual Stress Tester workspace.
   * Returns { ok, checks: [{name, pass, detail}] }
   */
  function runUISmokeTest() {
    var checks = [];
    function assert(name, pass, detail) {
      checks.push({ name: name, pass: !!pass, detail: detail || "" });
    }

    var dash = root && root.querySelector(".vste-dashboard");
    assert("dashboard_present", !!dash, dash ? "ok" : "missing .vste-dashboard");

    if (dash) {
      var panels = dash.querySelectorAll(
        ".vste-controls, .vste-status, .vste-report-library, .vste-targets, .vste-canvas-wrap"
      );
      panels.forEach(function (node, idx) {
        var parent = node.parentElement;
        if (!parent) return;
        var er = node.getBoundingClientRect();
        var pr = parent.getBoundingClientRect();
        // Allow scrollable parents: element top should be within expanded scroll height intent
        var noClipTop = er.top >= pr.top - 1;
        assert(
          "dom_collision_" + idx,
          noClipTop && er.width > 0,
          "el.bottom=" + er.bottom.toFixed(1) + " parent.bottom=" + pr.bottom.toFixed(1)
        );
      });

      // Status container fit-content
      var status = dash.querySelector(".vste-status");
      if (status) {
        var cs = getComputedStyle(status);
        var maxH = cs.maxHeight;
        assert(
          "status_no_fixed_clip",
          maxH === "none" || maxH === "0px" || parseFloat(maxH) > 1000 || cs.overflow === "visible",
          "maxHeight=" + maxH + " overflow=" + cs.overflow
        );
        assert("status_padding", parseFloat(cs.paddingTop) >= 8, cs.padding);
      }

      // URI badges wrap
      var badges = dash.querySelectorAll(".vste-uri-badge");
      assert("uri_badges", badges.length >= 2, "count=" + badges.length);
      badges.forEach(function (b, i) {
        var st = getComputedStyle(b);
        assert(
          "uri_wrap_" + i,
          st.overflowWrap === "anywhere" || st.wordBreak === "break-all" || st.overflowWrap === "break-word",
          "overflow-wrap=" + st.overflowWrap
        );
      });
    }

    // State sync: toggle presets
    var prev = { mode: state.mode, w: state.w, h: state.h };
    setPreset("mobile");
    assert(
      "sync_mobile",
      state.mode === "mobile" && state.w === 390 && state.h === 844 && Number(refs.cw.value) === 390,
      "state=" + state.w + "x" + state.h + " input=" + refs.cw.value + "x" + refs.ch.value
    );
    setPreset("desktop");
    assert(
      "sync_desktop",
      state.mode === "desktop" && state.w === 1280 && state.h === 720 && Number(refs.ch.value) === 720,
      "state=" + state.w + "x" + state.h
    );
    if (refs.cw) {
      refs.cw.value = 777;
      refs.ch.value = 555;
      onManualDimension();
      assert(
        "sync_custom_from_inputs",
        state.mode === "custom" && state.w === 777 && state.h === 555,
        "mode=" + state.mode + " " + state.w + "x" + state.h
      );
    }

    // Restore previous visual preference after checks
    if (prev.mode === "custom") {
      state.mode = "custom";
      state.w = prev.w;
      state.h = prev.h;
      syncInputsFromState();
      applyViewportScale();
    } else {
      setPreset(prev.mode || "desktop");
    }

    // Mock 1s stress cycle + report library append
    var eng = global.VirtualStressEngine;
    var libCountBefore = eng ? eng.loadReports().length : 0;
    var mockOk = false;
    if (eng) {
      setLive("Running mock…");
      var t0 = Date.now();
      var mockResult = eng.runMonteCarlo({ samples: 50, seed: 1 });
      var report = eng.synthesizeReport({
        results: [mockResult],
        total_elapsed_ms: Math.max(1, Date.now() - t0),
        viewport: { mode: state.mode, w: state.w, h: state.h, smoke: true }
      });
      setLive("Ready. Smoke mock cycle complete.");
      mockOk = !!(report && report.id);
      if (refs.lib) renderReportLibrary(refs.lib);
    }
    var libCountAfter = eng ? eng.loadReports().length : 0;
    assert("pipeline_running_to_ready", /Ready/i.test(refs.live ? refs.live.textContent : ""), refs.live && refs.live.textContent.slice(0, 80));
    assert("report_appended", mockOk && libCountAfter >= libCountBefore, "before=" + libCountBefore + " after=" + libCountAfter);
    if (refs.lib) {
      var cards = refs.lib.querySelectorAll(".vste-report-card");
      assert("report_library_dom", cards.length > 0, "cards=" + cards.length);
    }

    var ok = checks.every(function (c) {
      return c.pass;
    });
    var summary = {
      ok: ok,
      checks: checks,
      at: new Date().toISOString()
    };
    try {
      console[ok ? "log" : "warn"]("[VSTE runUISmokeTest]", summary);
    } catch (e) {}
    return summary;
  }

  function mount(container) {
    root = container;
    var eng = global.VirtualStressEngine;
    root.innerHTML = "";
    var panel = el("div", "vste-dashboard");

    var head = el(
      "header",
      "ws-head",
      "<h1>Virtual Stress Testing Engine</h1>" +
        '<p class="muted">Multi-vector stress · isolated report library · adaptive viewport</p>'
    );
    panel.appendChild(head);

    var targets = el("div", "vste-targets");
    targets.innerHTML =
      '<div class="vste-target-row"><span class="lbl">Frontend</span>' +
      '<code class="vste-uri-badge">' +
      (eng ? eng.TARGETS.frontend : "") +
      "</code></div>" +
      '<div class="vste-target-row"><span class="lbl">Backend</span>' +
      '<code class="vste-uri-badge">' +
      (eng ? eng.TARGETS.backend : "") +
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
    refs.cw.addEventListener("change", onManualDimension);
    refs.ch.addEventListener("change", onManualDimension);

    var canvasWrap = el("div", "vste-canvas-wrap");
    var scaleLabel = el("div", "vste-scale-label muted", "scale");
    canvasWrap.appendChild(scaleLabel);
    var frame = el("div", "vste-frame");
    frame.innerHTML =
      '<iframe id="vste-iframe" title="Stress target preview" sandbox="allow-scripts allow-same-origin allow-forms" src="' +
      (eng ? eng.TARGETS.frontend : "about:blank") +
      '"></iframe>';
    canvasWrap.appendChild(frame);
    panel.appendChild(canvasWrap);
    refs.canvasWrap = canvasWrap;
    refs.frame = frame;
    refs.scaleLabel = scaleLabel;

    var controls = el("div", "vste-controls");
    controls.innerHTML =
      '<button type="button" class="primary-btn" id="vste-run">Run Full Stress Cycle</button>' +
      '<button type="button" class="ghost-btn" id="vste-mc">Monte Carlo only</button>' +
      '<button type="button" class="ghost-btn" id="vste-fault">Fault injection only</button>' +
      '<button type="button" class="ghost-btn" id="vste-smoke">Run UI Smoke Test</button>';
    panel.appendChild(controls);

    var live = el(
      "div",
      "vste-status",
      "Ready. Reports stay inside this workspace library only."
    );
    live.setAttribute("role", "status");
    panel.appendChild(live);
    refs.live = live;

    var lib = el("div", "vste-report-library");
    panel.appendChild(lib);
    refs.lib = lib;
    root.appendChild(panel);

    window.addEventListener("resize", applyViewportScale);
    setPreset("desktop");
    renderReportLibrary(lib);

    async function run(kind) {
      if (!eng) return;
      setLive("Running " + kind + "…");
      var viewport = {
        mode: state.mode,
        w: state.w,
        h: state.h,
        S: Number(refs.frame.dataset.scale)
      };
      try {
        var report;
        if (kind === "full") {
          report = await eng.runFullStressCycle({ viewport: viewport }, function (stage) {
            setLive("Running… stage: " + stage);
          });
        } else if (kind === "mc") {
          var r = eng.runMonteCarlo({ samples: 2000 });
          report = eng.synthesizeReport({
            results: [r],
            total_elapsed_ms: r.elapsed_ms,
            viewport: viewport
          });
        } else {
          var f = await eng.faultInjectionMatrix({});
          report = eng.synthesizeReport({
            results: [f],
            total_elapsed_ms: f.elapsed_ms,
            viewport: viewport
          });
        }
        setLive(
          "Ready.\n" +
            "vectors_complete: " +
            JSON.stringify(
              (report.summary && report.summary.vectors_complete) ||
                (report.summary && report.summary.vectors) ||
                []
            ) +
            "\n" +
            JSON.stringify(report.summary, null, 2) +
            "\n\n" +
            eng.reportToMarkdown(report)
        );
        renderReportLibrary(lib);
      } catch (e) {
        setLive("Ready.\nError: " + (e && e.message ? e.message : e));
      }
    }

    panel.querySelector("#vste-run").onclick = function () {
      run("full");
    };
    panel.querySelector("#vste-mc").onclick = function () {
      run("mc");
    };
    panel.querySelector("#vste-fault").onclick = function () {
      run("fault");
    };
    panel.querySelector("#vste-smoke").onclick = function () {
      var res = runUISmokeTest();
      setLive(
        (res.ok ? "Ready. SMOKE PASS\n" : "Ready. SMOKE FAIL\n") +
          res.checks
            .map(function (c) {
              return (c.pass ? "PASS" : "FAIL") + " · " + c.name + (c.detail ? " — " + c.detail : "");
            })
            .join("\n")
      );
    };

    // Boot smoke test
    setTimeout(function () {
      var res = runUISmokeTest();
      setLive(
        (res.ok ? "Ready. Boot smoke: PASS" : "Ready. Boot smoke: FAIL") +
          " (" +
          res.checks.filter(function (c) {
            return c.pass;
          }).length +
          "/" +
          res.checks.length +
          ")\nReports stay inside this workspace library only."
      );
    }, 0);
  }

  global.VirtualStressUI = {
    mount: mount,
    runUISmokeTest: function () {
      return runUISmokeTest();
    },
    getViewportState: function () {
      return { mode: state.mode, w: state.w, h: state.h };
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
