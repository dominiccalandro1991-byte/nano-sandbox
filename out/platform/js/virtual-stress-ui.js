/**
 * Virtual Stress Tester Interactive Dashboard
 * Isolated report library UI — does not touch general file/vault libraries.
 */
(function (global) {
  "use strict";

  var root = null;
  var viewportMode = "desktop";
  var customW = 1280;
  var customH = 720;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function applyViewportScale(frame, mode) {
    var container = frame.parentElement;
    if (!container) return;
    var cw = container.clientWidth - 16;
    var ch = container.clientHeight - 16;
    var tw = 1280;
    var th = 800;
    if (mode === "mobile") {
      tw = 390;
      th = 844;
    } else if (mode === "desktop") {
      tw = 1280;
      th = 800;
    } else if (mode === "full") {
      tw = cw;
      th = ch;
    } else if (mode === "custom") {
      tw = customW;
      th = customH;
    }
    var S = Math.min(cw / tw, ch / th, 1);
    if (!isFinite(S) || S <= 0) S = 1;
    frame.style.width = tw + "px";
    frame.style.height = th + "px";
    frame.style.transform = "scale(" + S + ")";
    frame.style.transformOrigin = "top left";
    frame.dataset.scale = String(S);
    frame.dataset.targetW = String(tw);
    frame.dataset.targetH = String(th);
    var label = container.querySelector(".vste-scale-label");
    if (label)
      label.textContent =
        mode + " · " + tw + "×" + th + " · S=" + S.toFixed(3);
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

  function renderReportLibrary(host) {
    var eng = global.VirtualStressEngine;
    if (!eng) return;
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
            eng.reportToMarkdown(r).replace(/[<>&]/g, function (c) {
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

  function mount(container) {
    root = container;
    var eng = global.VirtualStressEngine;
    root.innerHTML = "";
    var panel = el("div", "vste-dashboard");
    panel.innerHTML =
      '<header class="ws-head"><h1>Virtual Stress Testing Engine</h1>' +
      '<p class="muted">Multi-vector stress · isolated report library · adaptive viewport</p></header>' +
      '<div class="vste-targets">' +
      "<div><span class=\"lbl\">Frontend</span><code id=\"vste-fe\">" +
      (eng ? eng.TARGETS.frontend : "") +
      "</code></div>" +
      "<div><span class=\"lbl\">Backend</span><code id=\"vste-be\">" +
      (eng ? eng.TARGETS.backend : "") +
      "</code></div></div>";

    var toggles = el("div", "vste-viewport-toggles");
    ["mobile", "desktop", "full", "custom"].forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ghost-btn" + (m === viewportMode ? " active" : "");
      b.textContent = m;
      b.onclick = function () {
        viewportMode = m;
        toggles.querySelectorAll("button").forEach(function (x) {
          x.classList.remove("active");
        });
        b.classList.add("active");
        applyViewportScale(frame, viewportMode);
      };
      toggles.appendChild(b);
    });
    panel.appendChild(toggles);

    var customRow = el("div", "vste-custom-dim");
    customRow.innerHTML =
      '<label>W <input id="vste-cw" type="number" value="1280" min="200" max="4000"/></label>' +
      '<label>H <input id="vste-ch" type="number" value="720" min="200" max="4000"/></label>';
    panel.appendChild(customRow);

    var canvasWrap = el("div", "vste-canvas-wrap");
    canvasWrap.innerHTML = '<div class="vste-scale-label muted">scale</div>';
    var frame = el("div", "vste-frame");
    frame.innerHTML =
      '<iframe id="vste-iframe" title="Stress target preview" sandbox="allow-scripts allow-same-origin allow-forms" src="' +
      (eng ? eng.TARGETS.frontend : "about:blank") +
      '"></iframe>';
    canvasWrap.appendChild(frame);
    panel.appendChild(canvasWrap);

    var controls = el("div", "vste-controls");
    controls.innerHTML =
      '<button type="button" class="primary-btn" id="vste-run">Run Full Stress Cycle</button>' +
      '<button type="button" class="ghost-btn" id="vste-mc">Monte Carlo only</button>' +
      '<button type="button" class="ghost-btn" id="vste-fault">Fault injection only</button>';
    panel.appendChild(controls);

    var live = el("pre", "vste-live code-block", "Ready. Reports stay inside this workspace library only.");
    panel.appendChild(live);

    var lib = el("div", "vste-report-library");
    panel.appendChild(lib);
    root.appendChild(panel);

    function refreshScale() {
      customW = Number(panel.querySelector("#vste-cw").value) || 1280;
      customH = Number(panel.querySelector("#vste-ch").value) || 720;
      applyViewportScale(frame, viewportMode);
    }
    panel.querySelector("#vste-cw").onchange = refreshScale;
    panel.querySelector("#vste-ch").onchange = refreshScale;
    window.addEventListener("resize", refreshScale);
    refreshScale();
    renderReportLibrary(lib);

    async function run(kind) {
      if (!eng) return;
      live.textContent = "Running " + kind + "…";
      var viewport = {
        mode: viewportMode,
        w: Number(frame.dataset.targetW),
        h: Number(frame.dataset.targetH),
        S: Number(frame.dataset.scale)
      };
      try {
        var report;
        if (kind === "full") {
          report = await eng.runFullCycle({ viewport: viewport }, function (stage) {
            live.textContent = "Stage: " + stage;
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
        live.textContent = JSON.stringify(report.summary, null, 2) + "\n\n" + eng.reportToMarkdown(report);
        renderReportLibrary(lib);
      } catch (e) {
        live.textContent = "Error: " + (e && e.message ? e.message : e);
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
  }

  global.VirtualStressUI = { mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
