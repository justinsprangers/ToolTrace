/* ToolTrace UI. Three phases:
   1. Capture: photo -> scale reference -> flattened image -> traced outlines -> library
   2. Layout: place library shapes (and finger notches) in a bin
   3. Generate: build the mesh, check it, preview, download
   The library and layout are kept in localStorage and can be saved as a project file. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d'), G = TT.GF;

  var S = {
    phase: 'capture', capView: 'photo', capTool: 'pick', layTool: 'select',
    photo: null, src: null, gray: null, corners: null, refMode: 'paper', gridFit: null,
    warp: null, warpCanvas: null, score: null, segMask: null, mask: null, overlay: null,
    shapes: [], strokes: [], stroke: null, libTick: {},
    lib: {}, libOrder: [], sel: null, gen: null, preview: null,
    views: {}, drag: null, pending: {}
  };
  var L = { nx: 2, ny: 1, clearance: 1, wall: 2, floor: 1.2, units: 3, autoUnits: true, maxUnits: 6, autoSize: true, chamfer: 1, items: [], notches: [] };

  // ---------- Small helpers ----------

  function later(key, fn, ms) { clearTimeout(S.pending[key]); S.pending[key] = setTimeout(fn, ms); }

  function status(msg, warn) { $('status').textContent = msg; $('status').className = warn ? 'warn' : ''; }

  // Run something slow with a "Working…" badge shown first.
  function work(msg, fn) {
    $('busy').textContent = msg; $('busy').hidden = false;
    setTimeout(function () {
      try { fn(); } catch (e) { console.error(e); status('Something went wrong: ' + e.message, true); }
      $('busy').hidden = true;
    }, 20);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  // "167.5 × 125.5 × 21 mm (6.59 × 4.94 × 0.83 in)"
  function dims(v) {
    return v.map(function (x) { return +x.toFixed(1); }).join(' × ') + ' mm (' + v.map(function (x) { return (x / 25.4).toFixed(2); }).join(' × ') + ' in)';
  }
  function fmt(mm) { return mm.toFixed(1) + ' mm (' + (mm / 25.4).toFixed(2) + ' in)'; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Labelled number box + slider, kept in sync. The number box accepts values past the slider range.
  var C = {};
  // A blue tick on the slider marks the default (recommended) value; ↺ appears once it's changed.
  function ctl(parent, id, label, min, max, step, value, unit, onInput) {
    var div = document.createElement('div'), f = Math.min(1, Math.max(0, (value - min) / (max - min)));
    div.className = 'ctl';
    div.innerHTML = '<div class="top"><label for="n_' + id + '">' + label + '</label><button class="reset" title="Back to the default (' + value + ')">↺</button>' +
      '<input type="number" id="n_' + id + '" step="' + step + '"><span class="unit">' + (unit || '') + '</span></div>' +
      '<div class="track"><input type="range"><span class="defmark" title="Default: ' + value + '" style="left:calc(8px + (100% - 16px) * ' + f + ' - 1px)"></span></div>';
    var num = div.querySelector('input[type=number]'), rng = div.querySelector('input[type=range]');
    rng.min = min; rng.max = max; rng.step = step;
    var mark = function () { div.classList.toggle('changed', Math.abs((parseFloat(num.value) || 0) - value) > 1e-9); };
    var set = function (v) { num.value = +(+v).toFixed(4); rng.value = v; mark(); };
    set(value);
    rng.addEventListener('input', function () { num.value = rng.value; mark(); onInput(+rng.value); });
    num.addEventListener('input', function () {
      if (num.value === '' || isNaN(+num.value)) return;
      rng.value = num.value; mark(); onInput(+num.value);
    });
    var reset = function () { set(value); onInput(value); };
    div.querySelector('.reset').onclick = reset;
    C[id] = { get: function () { return parseFloat(num.value) || 0; }, set: set, reset: reset, def: value, parent: parent };
    $(parent).appendChild(div);
  }

  // "Restore defaults" buttons reset every slider in their container.
  document.querySelectorAll('[data-reset]').forEach(function (b) {
    b.onclick = function () {
      Object.keys(C).forEach(function (id) { if (C[id].parent === b.dataset.reset) C[id].reset(); });
      if (b.dataset.reset === 'traceCtls' && !$('fillHoles').checked) { $('fillHoles').checked = true; $('fillHoles').onchange(); }
    };
  });

  // Remember which sections are open.
  (function () {
    var st = {};
    try { st = JSON.parse(localStorage.getItem('tooltrace.sections') || '{}'); } catch (e) { /* ignore */ }
    document.querySelectorAll('details[data-key]').forEach(function (d) {
      if (d.dataset.key in st) d.open = st[d.dataset.key];
      d.addEventListener('toggle', function () {
        st[d.dataset.key] = d.open;
        try { localStorage.setItem('tooltrace.sections', JSON.stringify(st)); } catch (e) { /* ignore */ }
      });
    });
  })();

  function segButtons(id, onPick) {
    $(id).querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        $(id).querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        onPick(b.dataset.mode);
      };
    });
  }

  // ---------- Persistence ----------

  function save() {
    later('save', function () {
      try { localStorage.setItem('tooltrace.v2', JSON.stringify({ lib: S.lib, libOrder: S.libOrder, L: L })); } catch (e) { /* storage unavailable */ }
    }, 300);
  }

  function load(data) {
    S.lib = data.lib || {}; S.libOrder = (data.libOrder || Object.keys(S.lib)).filter(function (id) { return S.lib[id]; });
    if (data.L) Object.keys(data.L).forEach(function (k) { L[k] = data.L[k]; });
    L.items = L.items.filter(function (it) { return S.lib[it.shapeId]; });
    S.sel = null; S.gen = null;
    syncLayoutInputs(); renderLib(); invalidate();
  }

  $('saveProject').onclick = function () {
    download('tooltrace-project.json', JSON.stringify({ app: 'ToolTrace', version: 2, lib: S.lib, libOrder: S.libOrder, L: L }), 'application/json');
  };
  $('openProject').onclick = function () { $('projectFile').click(); };
  $('projectFile').onchange = function () {
    var f = this.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var d = JSON.parse(t);
      if (S.libOrder.length && !confirm('Replace the current library and layout with this project?')) return;
      load(d); save(); status('Opened ' + f.name + '.');
    }).catch(function () { status('That file isn’t a ToolTrace project.', true); });
    this.value = '';
  };

  function download(name, data, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---------- Phases and toolbar ----------

  document.querySelectorAll('.phases button').forEach(function (b) { b.onclick = function () { setPhase(b.dataset.phase); }; });

  function setPhase(p) {
    S.phase = p;
    document.querySelectorAll('.phases button').forEach(function (b) { b.classList.toggle('on', b.dataset.phase === p); });
    ['capture', 'layout', 'generate'].forEach(function (k) { $('panel-' + k).hidden = k !== p; });
    if (p === 'layout') renderLib();
    if (p === 'generate' && !S.gen) $('genInfo').textContent = L.items.length ? 'Press Generate to build the model.' : 'Place some tools in Layout first.';
    toolbar(); draw();
  }

  function toolbar() {
    var tb = $('toolbar'), html = '';
    function seg(id, items, on) {
      return '<div class="seg" id="' + id + '">' + items.map(function (it) {
        return '<button data-mode="' + it[0] + '"' + (it[0] === on ? ' class="on"' : '') + ' title="' + (it[2] || '') + '">' + it[1] + '</button>';
      }).join('') + '</div>';
    }
    if (S.phase === 'capture') {
      html = seg('tbView', [['photo', 'Photo', 'Photo and reference handles (1)'], ['trace', 'Trace', 'Traced outlines and fix tools (2)']], S.capView);
      if (S.capView === 'trace') {
        html += '<div class="sep"></div>' + seg('tbTool', CAP_TOOLS.map(function (t) {
          return [t[0], '<i class="dot" style="background:' + (STROKE_COLORS[t[0]] || 'transparent') + '"></i>' + t[1], t[3] + ' (' + t[2] + ')'];
        }), S.capTool) +
          '<label class="brush" title="Brush size ([ and ])">Brush <input type="range" id="tbBrush" min="4" max="120" value="' + S.brush + '"></label>' +
          '<button class="b" id="tbUndo" title="Undo (Ctrl+Z)">Undo</button><button class="b" id="tbRedo" title="Redo (Ctrl+Y)">Redo</button>' +
          '<button class="b" id="tbClear" title="Remove all brush fixes and shape edits">Clear</button>';
      }
    } else if (S.phase === 'layout') {
      html = seg('tbTool', [['select', 'Select', 'Select, move, rotate (V)'], ['notch', 'Notch', 'Click to add or remove a finger notch (N)']], S.layTool) +
        '<button class="b" id="tbUndo" title="Undo (Ctrl+Z)">Undo</button><button class="b" id="tbRedo" title="Redo (Ctrl+Y)">Redo</button>';
    }
    html += '<div class="sep"></div><button class="b" id="tbFit" title="Fit view (F, or double-click)">Fit view</button><button class="b" id="tbKeys" title="Keyboard shortcuts (?)">Shortcuts</button>';
    tb.innerHTML = html;
    if ($('tbView')) segButtons('tbView', function (m) { S.capView = m; toolbar(); draw(); });
    if ($('tbTool')) segButtons('tbTool', function (m) { if (S.phase === 'capture') S.capTool = m; else S.layTool = m; draw(); });
    if ($('tbBrush')) $('tbBrush').oninput = function () { S.brush = +this.value; draw(); };
    if ($('tbUndo')) $('tbUndo').onclick = undo;
    if ($('tbRedo')) $('tbRedo').onclick = redo;
    if ($('tbClear')) $('tbClear').onclick = function () {
      if ((S.strokes.length || S.edits.length) && confirm('Remove all brush fixes and shape edits on this photo?')) {
        capEdit(); S.strokes = []; S.edits = []; runFrom('edit');
      }
    };
    $('tbKeys').onclick = function () { $('keys').showModal(); };
    $('tbFit').onclick = function () {
      var v = S.views[viewKey()];
      if (v) v.fit = true;
      if (S.preview) { S.preview.zoom = 1; }
      draw();
    };
  }

  // ---------- 1. Capture ----------

  // Fix tools: same names, keys and colours as LaserEngraver. [id, label, key, tooltip]
  var CAP_TOOLS = [
    ['select', 'Select', 'V', 'Click a shape to select it, then drag its nodes; click the outline to add a node'],
    ['pan', 'Pan', 'P', 'Drag to pan'],
    ['paint_keep', 'Brush keep', 'B', 'Adds exactly what you paint'],
    ['paint_remove', 'Brush erase', 'E', 'Removes exactly what you paint']
  ];
  var STROKE_COLORS = { paint_keep: '#38bdf8', paint_remove: '#f59e0b' };
  S.brush = 30; S.capTool = 'select'; S.capHist = []; S.capRedo = [];
  // Per-shape edits, found again after a re-trace by the point `at` inside the shape:
  // {at, off (left out), set (own outline settings or null), nodes (hand-edited node loops or null)}.
  S.edits = []; S.cSel = null; S.selNode = null; // S.sel is the Layout selection

  ctl('traceCtls', 'threshold', 'Sensitivity', 0.05, 1.5, 0.01, 0.35, '', function () { traceInput('score'); });
  ctl('traceCtls', 'lumWeight', 'Brightness weight', 0, 3, 0.05, 1, '', function () { traceInput('score'); });
  // Only needed for mat grid lines; it also blunts sharp tips, so it's off for paper.
  ctl('traceCtls', 'open', 'Remove thin lines', 0, 3, 0.25, 0, 'mm', function () { traceInput('seg'); });
  ctl('traceCtls', 'close', 'Bridge gaps', 0, 6, 0.25, 1, 'mm', function () { traceInput('seg'); });
  ctl('traceCtls', 'minArea', 'Ignore shapes under', 0, 5000, 50, 300, 'mm²', function () { traceInput('seg'); });
  ctl('traceCtls', 'margin', 'Ignore edge', 0, 30, 1, 3, 'mm', function () { traceInput('seg'); });
  // Outline settings: the defaults for every shape; a selected shape can have its own (sh_*).
  // Corners are pinned before smoothing, so smoothing only removes noise between them.
  var SET_CTLS = [
    ['smooth', 'Smooth noise', 0, 10, 0.5, 4, 'mm'],
    ['straighten', 'Snap straight edges', 0, 1.5, 0.05, 0.3, 'mm'],
    ['corner', 'Keep corners sharper than', 15, 180, 1, 35, '°'],
    ['fit', 'Node detail (max gap)', 0.1, 2, 0.05, 0.5, 'mm']
  ];
  SET_CTLS.forEach(function (c) {
    ctl('outlineCtls', c[0], c[1], c[2], c[3], c[4], c[5], c[6], function () { traceInput('fit'); });
    ctl('shapeCtls', 'sh_' + c[0], c[1], c[2], c[3], c[4], c[5], c[6], function () { shapeSettingsChanged(); });
  });
  ctl('symCtls', 'sh_axis', 'Axis angle', 0, 180, 0.5, 90, '°', function (v) { axisChanged(v); });
  function globalSet() { return { smooth: C.smooth.get(), straighten: C.straighten.get(), corner: C.corner.get(), fit: Math.max(0.1, C.fit.get()) }; }
  ctl('depthCtl', 'depth', 'Pocket depth', 1, 60, 0.5, 15, 'mm', function () {});
  $('fillHoles').onchange = function () { traceInput('seg'); };

  function traceInput(stage) {
    if (S.phase === 'capture' && S.capView !== 'trace') { S.capView = 'trace'; toolbar(); }
    later('trace', function () { runFrom(stage); }, stage === 'fit' ? 80 : 250);
  }

  segButtons('refMode', function (m) {
    S.refMode = m;
    document.querySelectorAll('[data-ref]').forEach(function (d) { d.hidden = d.dataset.ref !== m; });
    S.capView = 'photo'; toolbar();
    C.open.set(m === 'grid' ? 0.75 : 0);
    if (m === 'grid') fitGrid(); else S.gridFit = null;
    runFrom('warp');
  });
  ['paperSize', 'ptsW', 'ptsH', 'ptsUnit'].forEach(function (id) { $(id).addEventListener('input', function () { later('warp', function () { runFrom('warp'); }, 250); }); });
  ['gridSize', 'gridUnit', 'gridNx', 'gridNy'].forEach(function (id) {
    $(id).addEventListener('input', function () { later('warp', function () { fitGrid(); runFrom('warp'); }, 300); });
  });
  $('findPaper').onclick = function () {
    if (!S.src) return;
    var c = TT.detectPaper(S.src);
    if (c) { S.corners = c; runFrom('warp'); } else status('Couldn’t find the paper. Drag the handles onto its corners.', true);
  };
  $('detectGrid').onclick = function () {
    if (!S.src) return;
    work('Finding grid…', function () {
      if (!S.gray) S.gray = TT.gridGray(S.src);
      var g = TT.detectGrid(S.src, S.gray);
      if (!g) { status('Couldn’t find the grid. Put the handles on 4 crossings and type the square counts.', true); return; }
      var gc = TT.gridCorners(g);
      S.corners = gc.corners;
      $('gridNx').value = gc.nx; $('gridNy').value = gc.ny;
      fitGrid(); runFrom('warp', true);
    });
  };
  $('addShapes').onclick = addShapes;

  $('file').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () { loadImage(img, f.name); URL.revokeObjectURL(img.src); };
    img.onerror = function () { status('Could not read that image.', true); };
    img.src = URL.createObjectURL(f);
  });

  function loadImage(img, name) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, 4000 / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    S.photo = c; S.src = c.getContext('2d').getImageData(0, 0, c.width, c.height); S.gray = null;
    S.strokes = []; S.edits = []; S.cSel = null; S.selAt = null; S.selNode = null; S.capHist = []; S.capRedo = [];
    S.warp = null; S.shapes = []; S.traced = null;
    S.area = null; $('useArea').checked = false; $('areaTip').hidden = true;
    if (name) { $('shapeName').value = $('oneName').value = name.replace(/\.[^.]+$/, ''); updatePrefixEx(); }
    S.views['capture-photo'] = { fit: true }; S.views['capture-trace'] = { fit: true };
    var c4 = S.refMode === 'paper' ? TT.detectPaper(S.src) : null;
    S.corners = c4 || [[c.width * 0.25, c.height * 0.25], [c.width * 0.75, c.height * 0.25], [c.width * 0.75, c.height * 0.75], [c.width * 0.25, c.height * 0.75]];
    S.capView = 'photo'; setPhase('capture');
    if (S.refMode === 'grid') { $('detectGrid').click(); return; }
    if (S.refMode === 'paper' && !c4) status('Couldn’t find the paper. Drag the handles onto its corners.', true);
    runFrom('warp', !!c4);
  }
  TT.loadImage = loadImage; // for testing

  // Fit the grid from the handles + square counts and snap the handles onto the crossings.
  function fitGrid() {
    S.gridFit = null;
    if (!S.src || S.refMode !== 'grid') return;
    if (!S.gray) S.gray = TT.gridGray(S.src);
    var nx = Math.max(1, Math.round(+$('gridNx').value)), ny = Math.max(1, Math.round(+$('gridNy').value));
    var size = (+$('gridSize').value) * (+$('gridUnit').value);
    var g = TT.refineGrid(S.gray, S.corners, nx, ny);
    if (!g || !(size > 0)) { $('refInfo').innerHTML = '<span class="warn">Couldn’t match the grid. Check the handles sit on crossings and the square counts.</span>'; return; }
    var fit = TT.gridHomography(g, size);
    S.gridFit = { H: fit.H, nx: nx, ny: ny, size: size };
    S.corners = [[0, 0], [nx, 0], [nx, ny], [0, ny]].map(function (q) { return TT.applyH(fit.H, q[0] * size, q[1] * size); });
    var used = fit.used, total = (nx + 1) * (ny + 1);
    $('refInfo').innerHTML = esc('Grid: ' + nx + ' × ' + ny + ' squares = ' + fmt(nx * size) + ' × ' + fmt(ny * size) + '\nMatched ' + used + ' of ' + total + ' crossings, fit error ' + fit.rms.toFixed(2) + ' mm') +
      (fit.rms > 1.5 || used < 0.3 * total ? '\n<span class="warn">Poor match: check the counts and square size.</span>' : '');
  }

  // Paper mm -> image px mapping and the area to flatten.
  // Paper mm -> image px mapping and the area to flatten: the reference rectangle, or the work
  // area (green handles) if one is set, as a polygon in paper mm.
  function reference() {
    if (!S.src || !S.corners) return null;
    var H, w, h;
    if (S.refMode === 'grid') {
      var g = S.gridFit;
      if (!g) return null;
      H = g.H; w = g.nx * g.size; h = g.ny * g.size;
    } else {
      var a, b;
      if (S.refMode === 'paper') { var ps = $('paperSize').value.split('x').map(Number); a = ps[0]; b = ps[1]; }
      else { var u = +$('ptsUnit').value; a = (+$('ptsW').value) * u; b = (+$('ptsH').value) * u; }
      if (!(a > 0 && b > 0)) return null;
      var c = TT.orderCorners(S.corners), dims = TT.fitRef(c, a, b);
      $('refInfo').textContent = 'Reference: ' + fmt(dims[0]) + ' × ' + fmt(dims[1]);
      H = TT.homography([[0, 0], [dims[0], 0], [dims[0], dims[1]], [0, dims[1]]], c); w = dims[0]; h = dims[1];
    }
    if (!S.area) return { H: H, x0: 0, y0: 0, w: w, h: h };
    var inv = TT.invertH(H), poly = TT.orderCorners(S.area).map(function (p) { return TT.applyH(inv, p[0], p[1]); });
    var bx = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (p) { bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.min(bx[1], p[1]); bx[2] = Math.max(bx[2], p[0]); bx[3] = Math.max(bx[3], p[1]); });
    if (!(bx[2] - bx[0] > 1 && bx[3] - bx[1] > 1) || bx[2] - bx[0] > 5000 || bx[3] - bx[1] > 5000) return null;
    return { H: H, x0: bx[0], y0: bx[1], w: bx[2] - bx[0], h: bx[3] - bx[1], poly: poly };
  }

  // Work area: optional second set of handles (green) around where the tools are.
  $('useArea').onchange = function () {
    $('areaTip').hidden = !this.checked;
    if (this.checked && S.corners) {
      var c = TT.orderCorners(S.corners), cx = 0, cy = 0;
      c.forEach(function (p) { cx += p[0] / 4; cy += p[1] / 4; });
      S.area = c.map(function (p) { return [cx + (p[0] - cx) * 1.15, cy + (p[1] - cy) * 1.15]; });
    } else S.area = null;
    S.capView = 'photo'; toolbar();
    runFrom('warp');
  };

  var STAGES = ['warp', 'score', 'seg', 'edit', 'extract', 'fit'];

  // Re-run the capture pipeline from a stage onwards (later stages reuse cached results).
  function runFrom(stage, showTrace) {
    if (!S.src) return;
    var from = STAGES.indexOf(stage);
    work('Tracing…', function () {
      var t0 = performance.now();
      if (from <= 0 || !S.warp) {
        var ref = reference();
        if (!ref) { S.warp = null; S.shapes = []; draw(); return; }
        var res = Math.max(0.2, Math.sqrt(ref.w * ref.h / 1.5e6)); // edges are sub-pixel, so this is plenty
        S.warp = TT.warp(S.src, ref.H, ref.x0, ref.y0, ref.w, ref.h, res);
        S.lab = null;
        if (ref.poly) { // outside the work area counts as off the photo
          var wq = S.warp;
          for (var j = 0; j < wq.h; j++) for (var i = 0; i < wq.w; i++)
            if (!TT.pointInLoop([wq.ox + (i + 0.5) * wq.res, wq.oy + (j + 0.5) * wq.res], ref.poly)) wq.data[(j * wq.w + i) * 4 + 3] = 0;
        }
        S.warpCanvas = toCanvas(S.warp.data, S.warp.w, S.warp.h);
        S.views['capture-trace'] = { fit: true };
        from = 1;
      }
      var wp = S.warp;
      if (from <= 1 || !S.score) S.score = TT.scoreImage(wp, C.threshold.get(), C.lumWeight.get());
      if (from <= 2 || !S.segMask) {
        S.segMask = TT.segment(wp, S.score, {
          threshold: C.threshold.get(), margin: C.margin.get(), open: C.open.get(), close: C.close.get(),
          minArea: C.minArea.get(), fillHoles: $('fillHoles').checked
        });
      }
      if (from <= 3 || !S.mask) applyEdits();
      if (from <= 4 || !S.traced) {
        var minArea = Math.max(20, C.minArea.get());
        S.traced = TT.traceShapes(S.mask, wp, S.score.score, C.threshold.get()).filter(function (sh) { return sh.area >= minArea; });
      }
      fitShapes();
      describeShapes(performance.now() - t0);
      if (showTrace) { S.capView = 'trace'; toolbar(); }
      draw();
    });
  }

  // Brush strokes, in the order they were made.
  function applyEdits() {
    var wp = S.warp, n = wp.w * wp.h, mask = S.segMask.slice();
    S.strokes.forEach(function (st) { TT.paint(mask, wp, st.pts, st.r, st.mode === 'paint_keep' ? 1 : 0); });
    var over = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) if (mask[i]) { over[i * 4] = 255; over[i * 4 + 1] = 50; over[i * 4 + 3] = 70; }
    S.mask = mask;
    S.overlay = toCanvas(over, wp.w, wp.h);
  }

  // Turn traced outlines into node paths: hand-edited nodes win, then the shape's own settings,
  // then the global ones. Each edit finds its shape again by the point `at` inside it.
  function fitShapes() {
    var res = S.warp.res, gset = globalSet(), used = {};
    S.shapes = S.traced.map(function (t) {
      var e = null;
      for (var i = 0; i < S.edits.length; i++) if (!used[i] && TT.pointInLoop(S.edits[i].at, t.raw[0])) { e = S.edits[i]; used[i] = 1; break; }
      return finishShape({ traced: t, edit: e, nodes: e && e.nodes ? e.nodes : autoNodes(t, e, gset) });
    });
    if (S.selAt) {
      S.cSel = S.shapes.find(function (sh) { return TT.pointInLoop(S.selAt, sh.path[0]); }) || null;
      if (!S.cSel) S.selNode = null;
    }
    renderShapeList();
  }

  // Nodes fitted to a traced shape (own settings or the global ones). A symmetric shape is first
  // averaged with its mirror image, then its nodes are mirrored so the outline is exactly symmetric.
  function autoNodes(t, e, gset) {
    var set = e && e.set ? e.set : gset || globalSet(), raw = t.raw;
    if (e && e.sym) {
      var key = JSON.stringify(e.sym);
      if (!t.symCache || t.symCache.key !== key) t.symCache = { key: key, loops: TT.symmetrize(t.raw, e.sym) };
      raw = t.symCache.loops;
    }
    return raw.map(function (l) {
      var n = TT.fitNodes(l, set, S.warp.res);
      return e && e.sym ? TT.mirrorNodes(n, e.sym, 1) : n;
    });
  }

  // Cache the drawn path and size of a shape from its nodes.
  function finishShape(sh) {
    sh.path = sh.nodes.map(function (l) { return TT.nodePath(l, 0.3); });
    sh.box = shapeBox({ loops: sh.path });
    sh.off = !!(sh.edit && sh.edit.off);
    return sh;
  }

  function ensureEdit(sh) {
    if (!sh.edit) { sh.edit = { at: sh.traced.inside, off: false, set: null, nodes: null }; S.edits.push(sh.edit); }
    return sh.edit;
  }

  function shapeIndex(sh) { return S.shapes.indexOf(sh); }

  function selectShape(sh) {
    S.cSel = sh; S.selNode = null;
    S.selAt = sh ? sh.traced.inside : null;
    if (sh) $('oneName').value = shapeLabel(sh);
    renderShapeList(); draw();
  }

  // A shape's name: the one typed for it, else "Shape N".
  function shapeLabel(sh) { return (sh.edit && sh.edit.name) || 'Shape ' + (shapeIndex(sh) + 1); }
  $('oneName').oninput = function () {
    if (!S.cSel) return;
    ensureEdit(S.cSel).name = this.value.trim();
    renderShapeList();
  };
  function updatePrefixEx() {
    var first = S.shapes.find(function (sh) { return !sh.off; });
    $('prefixEx').textContent = ($('shapeName').value.trim() || 'tool') + ' ' + (first ? shapeLabel(first) : 'Shape 1');
  }
  $('shapeName').oninput = updatePrefixEx;

  function toggleOff(sh) {
    capEdit();
    ensureEdit(sh).off = !sh.off; sh.off = sh.edit.off;
    renderShapeList(); draw();
  }

  // Own settings for the selected shape (refits only that shape; hand edits are replaced).
  $('shOwn').onchange = function () {
    var sh = S.cSel;
    if (!sh) return;
    capEdit();
    var e = ensureEdit(sh);
    e.set = this.checked ? (e.set || globalSet()) : null;
    e.nodes = null;
    refitSelected();
  };
  function shapeSettingsChanged() {
    var sh = S.cSel;
    if (!sh) return;
    later('shape', function () {
      capEdit();
      var e = ensureEdit(sh);
      e.set = { smooth: C.sh_smooth.get(), straighten: C.sh_straighten.get(), corner: C.sh_corner.get(), fit: Math.max(0.1, C.sh_fit.get()) };
      e.nodes = null;
      refitSelected();
    }, 120);
  }
  $('shRefit').onclick = function () {
    var sh = S.cSel;
    if (!sh || !sh.edit || !sh.edit.nodes) return;
    capEdit(); sh.edit.nodes = null; refitSelected();
  };

  function refitSelected() {
    var sh = S.cSel, e = sh.edit;
    sh.nodes = e.nodes || autoNodes(sh.traced, e);
    finishShape(sh); S.selNode = null;
    renderShapeList(); draw();
  }

  // Symmetric outline for the selected shape: find the best mirror axis, then average the halves.
  $('shSym').onchange = function () {
    var sh = S.cSel;
    if (!sh) return;
    capEdit();
    var e = ensureEdit(sh);
    e.sym = this.checked ? TT.findAxis(sh.traced.raw) : null;
    e.nodes = null;
    refitSelected();
  };
  $('shFindAxis').onclick = function () {
    var sh = S.cSel;
    if (!sh || !sh.edit || !sh.edit.sym) return;
    capEdit(); sh.edit.sym = TT.findAxis(sh.traced.raw); sh.edit.nodes = null; refitSelected();
  };
  function axisChanged(v) {
    var sh = S.cSel;
    if (!sh || !sh.edit || !sh.edit.sym) return;
    later('axis', function () { capEdit(); sh.edit.sym = Object.assign({}, sh.edit.sym, { a: v }); sh.edit.nodes = null; refitSelected(); }, 150);
  }
  $('shDel').onclick = function () { if (S.cSel) toggleOff(S.cSel); };

  // The node loops of a shape just changed by hand: keep them as the shape's edit. For a
  // symmetric shape, `side` (the side of the axis that was edited) is mirrored onto the other.
  function nodesEdited(sh, side) {
    if (side && sh.edit && sh.edit.sym) sh.nodes = sh.nodes.map(function (l) { return TT.mirrorNodes(l, sh.edit.sym, side); });
    ensureEdit(sh).nodes = sh.nodes;
    finishShape(sh);
  }

  // Which side of the selected shape's axis a point is on (+1 / -1), or 0 if not symmetric.
  function axisSide(sh, p) {
    var ax = sh.edit && sh.edit.sym;
    if (!ax) return 0;
    var a = ax.a * Math.PI / 180;
    return ((p[0] - ax.p[0]) * -Math.sin(a) + (p[1] - ax.p[1]) * Math.cos(a)) >= 0 ? 1 : -1;
  }

  function renderShapeList() {
    var box = $('shapeList'), sel = S.cSel;
    box.innerHTML = '';
    S.shapes.forEach(function (sh, k) {
      var row = document.createElement('label');
      row.className = 'shaperow' + (sh === sel ? ' on' : '') + (sh.off ? ' off' : '');
      var w = sh.box[2] - sh.box[0], h = sh.box[3] - sh.box[1], tags = [];
      if (sh.edit && sh.edit.set) tags.push('own settings');
      if (sh.edit && sh.edit.nodes) tags.push('edited');
      row.innerHTML = '<input type="checkbox"' + (sh.off ? '' : ' checked') + ' title="Include this shape"><span>' + esc(shapeLabel(sh)) +
        ' <small>' + w.toFixed(0) + ' × ' + h.toFixed(0) + ' mm' + (tags.length ? ' · ' + tags.join(', ') : '') + '</small></span>';
      row.querySelector('input').onchange = function () { toggleOff(sh); };
      row.onclick = function (ev) { if (ev.target.tagName !== 'INPUT') { ev.preventDefault(); selectShape(sh === S.cSel ? null : sh); } };
      box.appendChild(row);
    });
    $('shapeSel').hidden = !sel;
    $('saveOne').hidden = !sel;
    updatePrefixEx();
    if (sel) {
      var own = !!(sel.edit && sel.edit.set), s = own ? sel.edit.set : globalSet();
      $('shTitle').textContent = shapeLabel(sel);
      $('shDel').textContent = sel.off ? 'Include shape (Del)' : 'Exclude shape (Del)';
      $('shOwn').checked = own;
      var sym = sel.edit && sel.edit.sym;
      $('shSym').checked = !!sym;
      $('symCtls').hidden = !sym;
      if (sym) C.sh_axis.set(sym.a);
      $('shapeCtls').hidden = !own;
      SET_CTLS.forEach(function (c) { C['sh_' + c[0]].set(s[c[0]]); });
      $('shRefit').disabled = !(sel.edit && sel.edit.nodes);
      var n = 0, nc = 0;
      sel.nodes.forEach(function (l) { n += l.length; l.forEach(function (nd) { if (nd.c) nc++; }); });
      $('shInfo').textContent = n + ' nodes (' + nc + ' corners)' + (sel.edit && sel.edit.nodes ? ', edited by hand' : '') +
        (sym && sym.score ? '\nHalves matched ' + Math.round(sym.score * 100) + '% before averaging' : '');
    }
  }

  function shapeBox(sh) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    sh.loops[0].forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    return b;
  }

  function describeShapes(ms) {
    var n = S.shapes.length;
    $('captureInfo').textContent = '';
    if (!n) status('Nothing traced yet. Check the reference handles, or lower the Sensitivity.', true);
    else status('Traced ' + n + ' shape' + (n > 1 ? 's' : '') + ' in ' + Math.round(ms) + ' ms. Untick shapes you don’t want, click one to edit its nodes, then “Add to library”.');
  }

  // All ticked shapes, named "prefix + shape name".
  function addShapes() {
    var use = S.shapes.filter(function (sh) { return !sh.off; });
    if (!use.length) { status('No shapes are ticked.', true); return; }
    var base = $('shapeName').value.trim();
    addToLib(use, function (sh) { return (base ? base + ' ' : '') + shapeLabel(sh); });
  }
  // Just the selected shape, under the name typed for it.
  $('addOne').onclick = function () {
    if (!S.cSel) { status('Select a shape first.', true); return; }
    var name = $('oneName').value.trim() || shapeLabel(S.cSel);
    addToLib([S.cSel], function () { return name; });
  };

  function addToLib(use, nameOf) {
    var depth = C.depth.get();
    use.forEach(function (sh) {
      var id = 's' + uid(), a = 0, cx = 0, cy = 0, o = sh.path[0];
      for (var i = 0, j = o.length - 1; i < o.length; j = i++) {
        var cr = o[j][0] * o[i][1] - o[i][0] * o[j][1];
        a += cr; cx += (o[j][0] + o[i][0]) * cr; cy += (o[j][1] + o[i][1]) * cr;
      }
      cx /= 3 * a; cy /= 3 * a;
      var loops = sh.path.map(function (l) { return TT.simplify(l, 0.02).map(function (p) { return [+(p[0] - cx).toFixed(3), +(p[1] - cy).toFixed(3)]; }); });
      var b = shapeBox({ loops: loops }), sym = sh.edit && sh.edit.sym;
      S.lib[id] = { id: id, name: nameOf(sh), loops: loops, depth: depth, w: b[2] - b[0], h: b[3] - b[1] };
      // Mirror axis (shape coordinates), used for symmetric finger notches in Layout.
      if (sym) S.lib[id].axis = { p: [+(sym.p[0] - cx).toFixed(3), +(sym.p[1] - cy).toFixed(3)], a: sym.a };
      S.libOrder.push(id);
    });
    save(); renderLib();
    $('captureInfo').innerHTML = esc('Added ' + use.map(nameOf).join(', ') + ' to the library.') + ' <a href="#" id="goLayout">Go to Layout →</a>';
    $('goLayout').onclick = function (e) { e.preventDefault(); setPhase('layout'); };
  }

  function toCanvas(data, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return c;
  }

  // ---------- 2. Layout ----------

  ctl('binCtls', 'clearance', 'Clearance around tools', 0, 4, 0.1, L.clearance, 'mm', function (v) { L.clearance = v; layoutChanged(true); });
  ctl('binCtls', 'wall', 'Min wall', 0, 10, 0.5, L.wall, 'mm', function (v) { L.wall = v; layoutChanged(true); });
  ctl('selCtls', 'selDepth', 'Pocket depth', 0.5, 80, 0.5, 15, 'mm', function (v) { var it = selItem(); if (it) { it.depth = v; layoutChanged(); } });
  ctl('selCtls', 'selRot', 'Rotation', -180, 180, 0.5, 0, '°', function (v) { var it = selItem(); if (it) { it.rot = v; layoutChanged(); } });
  ctl('notchCtls', 'notchD', 'Width (diameter)', 8, 50, 1, 22, 'mm', function () { draw(); });
  ctl('slotCtl', 'notchLen', 'Slot length', 15, 150, 1, 45, 'mm', function () { draw(); });
  $('notchShape').onchange = function () { $('slotCtl').hidden = this.value !== 'slot'; draw(); };
  ctl('notchCtls', 'notchDepth', 'Depth (max: the tool’s depth)', 1, 80, 0.5, 15, 'mm', function () {});

  $('autoSize').onchange = function () { L.autoSize = this.checked; layoutChanged(true); };
  ['nx', 'ny'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      L[id] = Math.max(1, Math.round(+$(id).value) || 1);
      L.autoSize = false; $('autoSize').checked = false;
      layoutChanged();
    });
  });
  $('centerAll').onclick = function () { center(); layoutChanged(); };
  $('clearBin').onclick = function () { if (confirm('Remove every tool and notch from the bin?')) { L.items = []; L.notches = []; S.sel = null; layoutChanged(true); } };
  $('rotL').onclick = function () { rotateSel(-90); };
  $('rotR').onclick = function () { rotateSel(90); };
  $('rotAuto').onclick = function () { var it = selItem(); if (it) { it.rot = TT.bestRotation(S.lib[it.shapeId]); layoutChanged(true); } };
  $('flip').onclick = function () { var it = selItem(); if (it) { it.flip = !it.flip; layoutChanged(true); } };
  $('dup').onclick = function () {
    var it = selItem();
    if (!it) return;
    var c = JSON.parse(JSON.stringify(it)), ids = {};
    c.uid = uid(); c.x += 10; c.y += 10;
    L.items.push(c);
    // The copy gets its own copies of the tool's notches.
    L.notches.filter(function (n) { return n.item === it.uid; }).forEach(function (n) { ids[n.id] = uid(); });
    L.notches.filter(function (n) { return n.item === it.uid; }).forEach(function (n) {
      L.notches.push(Object.assign({}, n, { id: ids[n.id], item: c.uid, pair: n.pair ? ids[n.pair] : null }));
    });
    S.sel = c.uid; layoutChanged(true);
  };
  $('del').onclick = deleteSel;
  // Mirror axis for the selected tool's shape (used for symmetric notches).
  $('findAxis').onclick = function () {
    var it = selItem();
    if (!it) return;
    var sh = S.lib[it.shapeId], ax = TT.findAxis(sh.loops);
    if (!ax) return;
    sh.axis = { p: ax.p, a: ax.a };
    save(); syncSel(); draw();
    status('Axis found: the halves match ' + Math.round(ax.score * 100) + '%.' + (ax.score < 0.9 ? ' That’s low, so this tool may not be symmetric.' : ''));
  };
  $('clearAxis').onclick = function () { var it = selItem(); if (it) { delete S.lib[it.shapeId].axis; save(); syncSel(); draw(); } };

  // ---------- Notches ----------
  // A notch is {id, x, y, d, len, ang, depth, item, pair}: a circle of diameter d, or a slot
  // (stadium) len long and d wide at angle ang. With `item` set it belongs to that tool: x, y, ang
  // are in the tool's shape coordinates, so it moves, rotates and flips with the tool, and its
  // depth never exceeds the tool's. `pair` is its mirror twin across the shape's axis.

  function toWorldItem(it, p) {
    var a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = it.flip ? -p[0] : p[0];
    return [it.x + c * x - s * p[1], it.y + s * x + c * p[1]];
  }
  function toItem(it, p) {
    var a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = p[0] - it.x, dy = p[1] - it.y;
    var x = c * dx + s * dy, y = -s * dx + c * dy;
    return [it.flip ? -x : x, y];
  }
  // Directions (degrees) between shape and bin coordinates.
  function angToWorld(it, a) { return (it.flip ? 180 - a : a) + it.rot; }
  function angToItem(it, w) { return it.flip ? 180 - (w - it.rot) : w - it.rot; }
  function mirrorAng(axis, a) { return 2 * axis.a - a; }
  function itemById(id) { return L.items.find(function (it) { return it.uid === id; }) || null; }

  function notchPos(n) {
    var it = n.item ? itemById(n.item) : null;
    return it ? toWorldItem(it, [n.x, n.y]) : [n.x, n.y];
  }
  function notchDepth(n) {
    var it = n.item ? itemById(n.item) : null;
    return it ? Math.min(n.depth, it.depth) : n.depth;
  }
  // A notch in bin coordinates (for drawing, hit tests and geometry).
  function notchWorld(n) {
    var it = n.item ? itemById(n.item) : null, p = notchPos(n);
    return { x: p[0], y: p[1], d: n.d, len: n.len || 0, ang: it ? angToWorld(it, n.ang || 0) : n.ang || 0, depth: notchDepth(n) };
  }
  function notchesWorld() {
    return L.notches.filter(function (n) { return !n.item || itemById(n.item); }).map(notchWorld);
  }

  // Size and shape for a new notch, from the controls.
  function newNotch() {
    var slot = $('notchShape').value === 'slot', d = C.notchD.get();
    return { d: d, len: slot ? Math.max(d + 1, C.notchLen.get()) : 0 };
  }

  // Where a notch would go for the mouse at p: snapped onto the nearest tool outline (within
  // 14 screen px, unless Alt is held) with a slot laid along the edge there, plus its mirror twin
  // if the tool has an axis. Returns {pos, ang, item, mirror: {pos, ang}} in bin coordinates.
  function notchTarget(p, noSnap) {
    var v = vt(), best = null, bd = 14 / v.s;
    if (!noSnap) L.items.forEach(function (it) {
      var l = placed(it)[0];
      for (var i = 0; i < l.length; i++) {
        var a = l[i], b = l[(i + 1) % l.length], dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll));
        var q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bd) { bd = d; best = { pos: q, item: it, ang: Math.atan2(dy, dx) * 180 / Math.PI }; }
      }
    });
    var tgt = best || { pos: p, item: null, ang: 0 };
    var sh = tgt.item && S.lib[tgt.item.shapeId];
    if (sh && sh.axis && $('notchMirror').checked) {
      var local = toItem(tgt.item, tgt.pos), m = TT.reflect(sh.axis, local);
      if (Math.hypot(m[0] - local[0], m[1] - local[1]) > C.notchD.get() / 2)
        tgt.mirror = { pos: toWorldItem(tgt.item, m), ang: angToWorld(tgt.item, mirrorAng(sh.axis, angToItem(tgt.item, tgt.ang))) };
    }
    return tgt;
  }

  function addNotch(tgt) {
    var nn = newNotch(), it = tgt.item, depth = C.notchDepth.get();
    if (!it) { L.notches.push({ id: uid(), x: tgt.pos[0], y: tgt.pos[1], d: nn.d, len: nn.len, ang: tgt.ang, depth: depth, item: null, pair: null }); return; }
    var lp = toItem(it, tgt.pos), a = { id: uid(), x: lp[0], y: lp[1], d: nn.d, len: nn.len, ang: angToItem(it, tgt.ang), depth: depth, item: it.uid, pair: null };
    L.notches.push(a);
    if (tgt.mirror) {
      var mp = toItem(it, tgt.mirror.pos), b = { id: uid(), x: mp[0], y: mp[1], d: nn.d, len: nn.len, ang: angToItem(it, tgt.mirror.ang), depth: depth, item: it.uid, pair: a.id };
      a.pair = b.id;
      L.notches.push(b);
    }
  }

  function removeNotch(n) {
    L.notches = L.notches.filter(function (q) { return q !== n && q.id !== n.pair; });
  }

  // Move a notch to world point p (its mirror twin follows).
  function moveNotch(n, p) {
    var it = n.item ? itemById(n.item) : null;
    if (!it) { n.x = p[0]; n.y = p[1]; return; }
    var lp = toItem(it, p);
    n.x = lp[0]; n.y = lp[1];
    var twin = n.pair && L.notches.find(function (q) { return q.id === n.pair; }), sh = S.lib[it.shapeId];
    if (twin && sh.axis) { var m = TT.reflect(sh.axis, lp); twin.x = m[0]; twin.y = m[1]; twin.ang = mirrorAng(sh.axis, n.ang || 0); }
  }

  function syncLayoutInputs() {
    $('nx').value = L.nx; $('ny').value = L.ny; $('autoSize').checked = L.autoSize;
    C.clearance.set(L.clearance); C.wall.set(L.wall);
    if (C.floor) { C.floor.set(L.floor); C.maxUnits.set(L.maxUnits); C.chamfer.set(L.chamfer); }
    $('autoUnits').checked = L.autoUnits; $('units').value = L.units;
  }

  function selItem() { return L.items.find(function (it) { return it.uid === S.sel; }) || null; }

  function placed(it) {
    var sh = S.lib[it.shapeId];
    if (!sh) return [];
    var loops = it.flip ? sh.loops.map(function (l) { return l.map(function (p) { return [-p[0], p[1]]; }); }) : sh.loops;
    return TT.placeLoops({ loops: loops }, it);
  }

  // Everything below works on items through `placed`, so flipping is handled in one place.
  function libForGeometry() {
    var lib = {};
    L.items.forEach(function (it) { lib[it.uid] = { loops: placed(Object.assign({}, it, { x: 0, y: 0, rot: 0 })) }; });
    return lib;
  }
  function layoutForGeometry() {
    var c = Object.assign({}, L);
    c.items = L.items.map(function (it) { return Object.assign({}, it, { shapeId: it.uid, rot: it.rot, flip: false }); });
    c.notches = notchesWorld();
    return c;
  }

  function rotateSel(d) { var it = selItem(); if (it) { it.rot = ((it.rot + d + 540) % 360) - 180; layoutChanged(true); } }

  function deleteSel() {
    if (!S.sel) return;
    var gone = S.sel;
    L.items = L.items.filter(function (it) { return it.uid !== gone; });
    L.notches = L.notches.filter(function (n) { return n.item !== gone; });
    S.sel = null; layoutChanged(true);
  }

  // Shift every tool and notch so the layout sits in the middle of the bin.
  function center() {
    var b = TT.layoutBox(layoutForGeometry(), libForGeometry());
    if (!b) return;
    var dx = TT.binSize(L.nx) / 2 - (b[0] + b[2]) / 2, dy = TT.binSize(L.ny) / 2 - (b[1] + b[3]) / 2;
    L.items.forEach(function (it) { it.x += dx; it.y += dy; });
    L.notches.forEach(function (n) { if (!n.item) { n.x += dx; n.y += dy; } }); // tool notches move with the tool
  }

  // After an edit: refit the bin (if automatic), invalidate the model, save, redraw.
  function layoutChanged(refit) {
    if (refit !== false && L.autoSize && (L.items.length || L.notches.length)) {
      var f = TT.fitBin(layoutForGeometry(), libForGeometry());
      if (f) { L.nx = f.nx; L.ny = f.ny; center(); }
      $('nx').value = L.nx; $('ny').value = L.ny;
    }
    invalidate(); save(); syncSel(); describeLayout(); layoutSnapshot(); draw();
  }

  function invalidate() {
    S.gen = null; S.preview = null;
    $('downloads').innerHTML = '<p class="hint">Generate the model first.</p>';
    $('genInfo').textContent = L.items.length ? 'Layout changed. Press Generate to rebuild.' : '';
  }

  function syncSel() {
    var it = selItem();
    $('selSection').hidden = !it;
    if (!it) return;
    $('selName').textContent = S.lib[it.shapeId].name;
    C.selDepth.set(it.depth); C.selRot.set(+it.rot.toFixed(1));
    var ax = S.lib[it.shapeId].axis;
    $('axisInfo').textContent = ax ? 'Has a symmetry axis (pink): notches placed on it get a mirrored twin.' : 'No symmetry axis.';
    $('clearAxis').hidden = !ax;
    $('findAxis').textContent = ax ? 'Find axis again' : 'Add symmetry axis';
  }

  // Warnings about tools too close to the bin edge.
  function describeLayout() {
    var lines = [], W = TT.binSize(L.nx), H = TT.binSize(L.ny), tight = [];
    lines.push('Bin: ' + L.nx + ' × ' + L.ny + ' units = ' + dims([W, H]));
    var pcs = TT.pieces(L);
    if (pcs.length > 1) lines.push('Prints as ' + pcs.length + ' pieces (max ' + L.maxUnits + ' units each)');
    L.items.forEach(function (it) {
      var d = Infinity;
      placed(it)[0].forEach(function (p) { d = Math.min(d, p[0], p[1], W - p[0], H - p[1]); });
      if (d - L.clearance < L.wall - 0.05) tight.push(S.lib[it.shapeId].name);
    });
    $('layoutInfo').innerHTML = esc(lines.join('\n')) + (tight.length ? '\n<span class="warn">Too close to the edge: ' + esc(tight.join(', ')) + '</span>' : '');
  }

  function renderLib() {
    var box = $('lib');
    box.innerHTML = '';
    $('libEmpty').hidden = S.libOrder.length > 0;
    S.libOrder.forEach(function (id) {
      var sh = S.lib[id], row = document.createElement('div');
      row.className = 'libitem';
      row.innerHTML = '<input type="checkbox" title="Tick to delete several at once"' + (S.libTick[id] ? ' checked' : '') + '>' +
        '<canvas width="128" height="88"></canvas><div class="meta"><input type="text"><small>' +
        sh.w.toFixed(0) + ' × ' + sh.h.toFixed(0) + ' mm</small></div><button title="Add to bin">Add</button><button title="Delete from library">✕</button>';
      row.querySelector('input[type=checkbox]').onchange = function () { if (this.checked) S.libTick[id] = 1; else delete S.libTick[id]; libBar(); };
      var c = row.querySelector('canvas'), g = c.getContext('2d'), b = shapeBox(sh), k = Math.min(116 / (b[2] - b[0]), 76 / (b[3] - b[1]));
      g.setTransform(k, 0, 0, k, 64 - k * (b[0] + b[2]) / 2, 44 - k * (b[1] + b[3]) / 2);
      g.beginPath();
      sh.loops.forEach(function (l) { l.forEach(function (p, i) { g[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); g.closePath(); });
      g.fillStyle = '#e8590c'; g.fill('evenodd');
      var name = row.querySelector('input[type=text]');
      name.value = sh.name;
      name.onchange = function () { sh.name = name.value; save(); syncSel(); };
      var bt = row.querySelectorAll('button');
      bt[0].onclick = function () { addItem(id); };
      bt[1].onclick = function () { deleteLib([id]); };
      box.appendChild(row);
    });
    libBar();
  }

  function libBar() {
    var n = Object.keys(S.libTick).filter(function (id) { return S.lib[id]; }).length;
    $('libDel').disabled = !n;
    $('libDel').textContent = n ? 'Delete ticked (' + n + ')' : 'Delete ticked';
    $('libAll').checked = n > 0 && n === S.libOrder.length;
  }
  $('libAll').onchange = function () {
    S.libTick = {};
    if (this.checked) S.libOrder.forEach(function (id) { S.libTick[id] = 1; });
    renderLib();
  };
  $('libDel').onclick = function () {
    var ids = Object.keys(S.libTick).filter(function (id) { return S.lib[id]; });
    if (ids.length && confirm('Delete ' + ids.length + ' shape' + (ids.length > 1 ? 's' : '') + ' from the library (and the bin)?')) deleteLib(ids);
  };

  // Delete library shapes (and their tools and notches in the bin). One level of undo via the
  // status bar, so single deletes don't need a confirmation.
  function deleteLib(ids) {
    var gone = {};
    ids.forEach(function (id) { gone[id] = 1; });
    S.libUndo = { lib: ids.map(function (id) { return S.lib[id]; }), order: S.libOrder.slice(), items: L.items.slice(), notches: L.notches.slice() };
    ids.forEach(function (id) { delete S.lib[id]; delete S.libTick[id]; });
    S.libOrder = S.libOrder.filter(function (x) { return !gone[x]; });
    var keep = L.items.filter(function (it) { return !gone[it.shapeId]; }), keepIds = {};
    keep.forEach(function (it) { keepIds[it.uid] = 1; });
    L.items = keep;
    L.notches = L.notches.filter(function (n) { return !n.item || keepIds[n.item]; });
    if (!selItem()) S.sel = null;
    renderLib(); layoutChanged(true);
    $('status').innerHTML = esc('Deleted ' + S.libUndo.lib.map(function (s) { return '“' + s.name + '”'; }).join(', ') + '.') + ' <a href="#" id="libUndo">Undo</a>';
    $('status').className = '';
    $('libUndo').onclick = function (e) {
      e.preventDefault();
      var u = S.libUndo;
      if (!u) return;
      u.lib.forEach(function (s) { S.lib[s.id] = s; });
      S.libOrder = u.order; L.items = u.items; L.notches = u.notches; S.libUndo = null;
      renderLib(); layoutChanged(true); status('Restored.');
    };
  }

  // New item is laid landscape and goes below what's already in the bin.
  function addItem(id) {
    var sh = S.lib[id], it = { uid: uid(), shapeId: id, x: 0, y: 0, rot: TT.bestRotation(sh), flip: false, depth: sh.depth };
    var b0 = TT.layoutBox({ items: [it], notches: [], clearance: 0 }, S.lib);
    var b = L.items.length ? TT.layoutBox(layoutForGeometry(), libForGeometry()) : null;
    if (b) { it.x = b[0] + L.clearance - b0[0]; it.y = b[3] + 4 + L.clearance - b0[1]; }
    else { it.x = L.wall + L.clearance - b0[0] + 1; it.y = L.wall + L.clearance - b0[1] + 1; }
    L.items.push(it); S.sel = it.uid;
    if (!L.autoSize) center();
    S.views.layout = { fit: true };
    layoutChanged(true);
    if (S.phase !== 'layout') setPhase('layout');
    status('Added “' + sh.name + '”. Drag to move it, drag the round handle to rotate.');
  }

  // ---------- 3. Generate ----------

  ctl('genCtls', 'floor', 'Min floor under pockets', 0.6, 5, 0.1, L.floor, 'mm', function (v) { L.floor = v; invalidate(); save(); });
  ctl('genCtls', 'chamfer', 'Pocket edge chamfer (45°)', 0, 4, 0.25, L.chamfer, 'mm', function (v) { L.chamfer = v; invalidate(); save(); });
  ctl('genCtls', 'maxUnits','Max units per print', 1, 12, 1, L.maxUnits, '', function (v) { L.maxUnits = Math.max(1, Math.round(v)); invalidate(); save(); describeLayout(); });
  $('autoUnits').onchange = function () { L.autoUnits = this.checked; invalidate(); save(); };
  $('units').oninput = function () { L.units = Math.max(1, Math.round(+this.value) || 1); L.autoUnits = false; $('autoUnits').checked = false; invalidate(); save(); };
  $('generate').onclick = generate;

  function generate() {
    if (!L.items.length && !L.notches.length) { $('genInfo').textContent = 'Place some tools in Layout first.'; return; }
    work('Building model…', function () {
      var t0 = performance.now();
      var GL = layoutForGeometry(), lib = libForGeometry();
      if (L.autoUnits) { L.units = GL.units = TT.autoHeight(GL); $('units').value = L.units; }
      var top = L.units * G.unitH, floor = top - TT.maxDepth(GL) - G.baseH;
      var fields = TT.pocketFields(GL, lib), pieces = TT.pieces(L), problems = [], tris = 0;
      var meshes = pieces.map(function (pc, k) {
        var m = TT.pieceMesh(GL, fields, pc), open = 0, inverted = 0;
        m.shells.forEach(function (s) { open += TT.openEdges(s); if (TT.volume(s) <= 0) inverted++; tris += s.length / 9; });
        if (open || inverted || m.missingArea > 1)
          problems.push('piece ' + (k + 1) + ': ' + open + ' open edges, ' + inverted + ' inside-out bodies, ' + m.missingArea.toFixed(1) + ' mm² missing');
        return { pc: pc, shells: m.shells, ox: pc.ix * (G.pitch + 8), oy: (L.ny - pc.iy - pc.ky) * (G.pitch + 8) };
      });
      // Thinnest wall between any pocket and the outside of the bin.
      var all = fields[fields.length - 1], W = TT.binSize(L.nx), H = TT.binSize(L.ny), minWall = Infinity;
      if (all) for (var j = 0; j < all.h; j++) for (var i = 0; i < all.w; i++) {
        if (all.f[j * all.w + i] >= 0) continue;
        var x = -1 + i * all.res, y = -1 + j * all.res;
        minWall = Math.min(minWall, x, y, W - x, H - y);
      }
      S.gen = { meshes: meshes, fields: fields, GL: GL };
      S.preview = new TT.Preview3D(meshes);
      var lines = [L.nx + ' × ' + L.ny + ' units, ' + L.units + ' high', dims([W, H, top]),
        pieces.length + ' piece' + (pieces.length > 1 ? 's' : '') + ', ' + Math.round(tris).toLocaleString() + ' triangles, built in ' + Math.round(performance.now() - t0) + ' ms'];
      var warn = [];
      if (floor < L.floor - 0.01) warn.push('Floor under the deepest pocket is only ' + floor.toFixed(1) + ' mm. Add height units.');
      if (minWall < L.wall - 0.05) warn.push('A pocket comes within ' + Math.max(0, minWall).toFixed(1) + ' mm of the bin edge.');
      if (problems.length) warn.push('Mesh check failed: ' + problems.join('; '));
      $('genInfo').innerHTML = esc(lines.join('\n')) + '\n' + (problems.length ? '' : '<span class="ok">Mesh check passed (every body closed).</span>') +
        (warn.length ? '\n<span class="warn">' + esc(warn.join('\n')) + '</span>' : '');
      renderDownloads();
      S.views.generate = { fit: true };
      draw();
      status('Model ready. Drag to turn it, scroll to zoom.');
    });
  }

  function renderDownloads() {
    var box = $('downloads'), base = (S.libOrder.length && L.items.length ? S.lib[L.items[0].shapeId].name : 'bin').replace(/[^\w.-]+/g, '_');
    box.innerHTML = '';
    var many = S.gen.meshes.length > 1;
    function button(label, fn, primary) {
      var b = document.createElement('button');
      b.className = 'b' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn;
      box.appendChild(b);
    }
    function name(m, k) { return base + '_' + m.pc.kx + 'x' + m.pc.ky + 'x' + L.units + (many ? '_part' + (k + 1) : '') + '.stl'; }
    if (many) button('Download all ' + S.gen.meshes.length + ' STLs', function () {
      S.gen.meshes.forEach(function (m, k) { setTimeout(function () { download(name(m, k), TT.stl(m.shells), 'model/stl'); }, k * 400); });
    }, true);
    S.gen.meshes.forEach(function (m, k) {
      var pw = TT.binSize(m.pc.kx), ph = TT.binSize(m.pc.ky);
      button((many ? 'Piece ' + (k + 1) + ': ' : '') + m.pc.kx + ' × ' + m.pc.ky + ' units · ' + pw + ' × ' + ph + ' mm (' + (pw / 25.4).toFixed(1) + ' × ' + (ph / 25.4).toFixed(1) + ' in)', function () { download(name(m, k), TT.stl(m.shells), 'model/stl'); }, !many);
    });
    button('Pocket outline (SVG, 1:1)', function () { download(base + '_outline.svg', TT.svg(L, S.gen.fields), 'image/svg+xml'); });
  }

  // ---------- Views: zoom / pan ----------

  function viewKey() { return S.phase === 'capture' ? 'capture-' + S.capView : S.phase; }

  // World extents of the current 2D view.
  function extents() {
    if (S.phase === 'capture' && S.capView === 'photo') return S.src ? [0, 0, S.src.width, S.src.height] : null;
    if (S.phase === 'capture') return S.warp ? [S.warp.ox, S.warp.oy, S.warp.ox + S.warp.w * S.warp.res, S.warp.oy + S.warp.h * S.warp.res] : null;
    if (S.phase === 'layout') return [-5, -5, TT.binSize(L.nx) + 5, TT.binSize(L.ny) + 5];
    return null;
  }

  function vt() {
    var k = viewKey(), v = S.views[k] || (S.views[k] = { fit: true }), e = extents();
    if (v.fit && e) {
      var cw = cv.clientWidth, ch = cv.clientHeight, pad = 16;
      v.s = Math.max(1e-3, Math.min((cw - 2 * pad) / (e[2] - e[0]), (ch - 2 * pad) / (e[3] - e[1])));
      v.x = (cw - (e[2] - e[0]) * v.s) / 2 - e[0] * v.s; v.y = (ch - (e[3] - e[1]) * v.s) / 2 - e[1] * v.s;
    }
    return v;
  }

  function toWorld(e) {
    var r = cv.getBoundingClientRect(), v = vt();
    return [(e.clientX - r.left - v.x) / v.s, (e.clientY - r.top - v.y) / v.s];
  }

  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (S.phase === 'generate') { if (S.preview) { S.preview.zoom *= Math.exp(-e.deltaY * 0.0015); draw(); } return; }
    var v = vt(), r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * 0.0015);
    v.fit = false;
    v.x = mx - (mx - v.x) * k; v.y = my - (my - v.y) * k; v.s *= k;
    draw();
  }, { passive: false });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- Drawing ----------

  function draw() {
    var dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e7e7e3'; ctx.fillRect(0, 0, cw, ch);
    if (S.phase === 'capture' && S.capView === 'photo') drawPhoto(dpr);
    else if (S.phase === 'capture') drawTrace(dpr);
    else if (S.phase === 'layout') drawLayout(dpr);
    else drawModel(dpr, cw, ch);
  }
  window.addEventListener('resize', draw);

  function world(dpr) { var v = vt(); ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y); return v; }

  function message(dpr, text) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#777'; ctx.font = '15px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(text, cv.clientWidth / 2, cv.clientHeight / 2);
    ctx.textAlign = 'start';
  }

  function drawPhoto(dpr) {
    if (!S.src) { message(dpr, 'Choose a photo to start.'); return; }
    var v = world(dpr);
    ctx.drawImage(S.photo, 0, 0);
    if (S.refMode === 'grid' && S.gridFit) {
      // Fitted grid lines, so a wrong count or size is easy to spot.
      var g = S.gridFit, step = Math.max(1, Math.ceil(Math.max(g.nx, g.ny) / 80));
      ctx.strokeStyle = 'rgba(0,200,255,0.75)'; ctx.lineWidth = 1 / v.s;
      ctx.beginPath();
      for (var i = 0; i <= g.nx; i += step) { var a = TT.applyH(g.H, i * g.size, 0), b = TT.applyH(g.H, i * g.size, g.ny * g.size); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (var j = 0; j <= g.ny; j += step) { var c = TT.applyH(g.H, 0, j * g.size), d = TT.applyH(g.H, g.nx * g.size, j * g.size); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); }
      ctx.stroke();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var scr = function (p) { return [p[0] * v.s + v.x, p[1] * v.s + v.y]; };
    // Reference handles (orange) and the optional work area (green, dashed).
    [[S.corners, '#e8590c', 'rgba(232,89,12,0.3)', []], [S.area, '#2b8a3e', 'rgba(43,138,62,0.25)', [8, 5]]].forEach(function (set) {
      if (!set[0]) return;
      var c4 = TT.orderCorners(set[0]).map(scr);
      ctx.strokeStyle = set[1]; ctx.lineWidth = 2; ctx.setLineDash(set[3]);
      ctx.beginPath(); c4.forEach(function (p, k) { ctx[k ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      set[0].forEach(function (p) {
        var q = scr(p);
        ctx.beginPath(); ctx.arc(q[0], q[1], 10, 0, 7); ctx.fillStyle = set[2]; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q[0] - 4, q[1]); ctx.lineTo(q[0] + 4, q[1]); ctx.moveTo(q[0], q[1] - 4); ctx.lineTo(q[0], q[1] + 4); ctx.stroke();
      });
    });
    if (S.drag && S.drag.corner !== undefined) drawLoupe((S.drag.area ? S.area : S.corners)[S.drag.corner]);
  }

  // Magnified view around a dragged handle, in the top-left corner.
  function drawLoupe(p) {
    var size = 180, zoom = 5, r = size / zoom / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(10, 10, size, size); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.photo, p[0] - r, p[1] - r, 2 * r, 2 * r, 10, 10, size, size);
    ctx.restore();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(10, 10, size, size);
    ctx.strokeStyle = '#e8590c';
    ctx.beginPath(); ctx.moveTo(10 + size / 2, 10); ctx.lineTo(10 + size / 2, 10 + size);
    ctx.moveTo(10, 10 + size / 2); ctx.lineTo(10 + size, 10 + size / 2); ctx.stroke();
  }

  function drawTrace(dpr) {
    if (!S.warp) { message(dpr, S.src ? 'Set the scale reference first.' : 'Choose a photo to start.'); return; }
    var wp = S.warp, v = world(dpr);
    ctx.save();
    ctx.translate(wp.ox, wp.oy); ctx.scale(wp.res, wp.res);
    ctx.drawImage(S.warpCanvas, 0, 0);
    if (S.overlay) ctx.drawImage(S.overlay, 0, 0);
    ctx.restore();
    // Outlines: included = yellow with small node dots, left out = grey dashed, selected = blue
    // with editable nodes (square = corner, round = smooth).
    S.shapes.forEach(function (sh) {
      ctx.beginPath();
      sh.path.forEach(function (l) { l.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); });
      if (sh.off) { ctx.setLineDash([6 / v.s, 4 / v.s]); ctx.strokeStyle = 'rgba(80,80,80,0.9)'; ctx.lineWidth = 1.5 / v.s; }
      else { ctx.strokeStyle = sh === S.cSel ? '#1c7ed6' : '#ffd400'; ctx.lineWidth = (sh === S.cSel ? 2.5 : 2) / v.s; }
      ctx.stroke(); ctx.setLineDash([]);
      if (sh !== S.cSel && !sh.off) {
        ctx.fillStyle = '#00c2ff';
        sh.nodes.forEach(function (l) { l.forEach(function (nd) { if (nd.c) { ctx.beginPath(); ctx.arc(nd.x, nd.y, 2.5 / v.s, 0, 7); ctx.fill(); } }); });
      }
    });
    if (S.cSel && S.cSel.edit && S.cSel.edit.sym) drawAxis(S.cSel.edit.sym, S.cSel.box, v);
    if (S.cSel) {
      var hs = 4.5 / v.s;
      S.cSel.nodes.forEach(function (l, li) {
        l.forEach(function (nd, k) {
          var on = S.selNode && S.selNode.loop === li && S.selNode.k === k;
          ctx.fillStyle = on ? '#1c7ed6' : '#fff'; ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = 1.5 / v.s;
          ctx.beginPath();
          if (nd.c) ctx.rect(nd.x - hs, nd.y - hs, 2 * hs, 2 * hs); else ctx.arc(nd.x, nd.y, hs, 0, 7);
          ctx.fill(); ctx.stroke();
        });
      });
    }
    // Fix strokes (faint) and the one being drawn.
    function strokePath(st) {
      ctx.strokeStyle = STROKE_COLORS[st.mode];
      ctx.lineWidth = 2 * st.r; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); st.pts.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); });
      if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] + 0.01, st.pts[0][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.3; S.strokes.forEach(strokePath);
    ctx.globalAlpha = 0.6; if (S.stroke) strokePath(S.stroke);
    ctx.globalAlpha = 1;
    // Size labels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 12px system-ui';
    S.shapes.forEach(function (sh) {
      if (sh.off) return;
      var b = sh.box, x = ((b[0] + b[2]) / 2) * v.s + v.x, y = b[3] * v.s + v.y + 16, t = (b[2] - b[0]).toFixed(0) + ' × ' + (b[3] - b[1]).toFixed(0) + ' mm';
      var tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - tw / 2 - 5, y - 13, tw + 10, 18);
      ctx.fillStyle = '#fff'; ctx.fillText(t, x - tw / 2, y);
    });
    // Brush cursor.
    if (S.mouse && STROKE_COLORS[S.capTool] && !S.space) {
      var r = Math.max(1, S.brush / 2);
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(S.mouse[0], S.mouse[1], r + 1, 0, 7); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = STROKE_COLORS[S.capTool];
      ctx.beginPath(); ctx.arc(S.mouse[0], S.mouse[1], r, 0, 7); ctx.stroke();
    }
    drawRuler();
  }

  // A notch (bin coordinates): filled shape plus outline. Slots are a fat round-capped line, so
  // the outline is drawn as the same line widened and the fill on top of it.
  function drawNotch(n, fill, line, v, bold) {
    var lw = (bold ? 3 : 1.5) / v.s;
    TT.notchPath(ctx, n);
    if (n.len > n.d) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = line; ctx.lineWidth = n.d + 2 * lw; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = n.d; ctx.stroke();
      ctx.strokeStyle = fill; ctx.stroke();
    } else {
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke();
    }
  }

  // Dashed mirror axis across a box (world units, current transform).
  function drawAxis(ax, box, v) {
    var a = ax.a * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), L = Math.hypot(box[2] - box[0], box[3] - box[1]) * 0.6 + 10;
    ctx.save();
    ctx.strokeStyle = '#d6336c'; ctx.lineWidth = 1.5 / v.s; ctx.setLineDash([8 / v.s, 5 / v.s]);
    ctx.beginPath(); ctx.moveTo(ax.p[0] - ux * L, ax.p[1] - uy * L); ctx.lineTo(ax.p[0] + ux * L, ax.p[1] + uy * L); ctx.stroke();
    ctx.restore();
  }

  function drawRuler() {
    var v = vt(), len = 50 * v.s, x = 16, y = cv.clientHeight - 16;
    if (len < 20) len = 100 * v.s;
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.fillStyle = '#222'; ctx.fillRect(x, y - 3, len, 3);
    ctx.font = '12px system-ui'; ctx.fillText(len === 50 * v.s ? '50 mm' : '100 mm', x, y - 7);
  }

  function depthColour(d, a) {
    var max = Math.max(1, TT.maxDepth(L)), t = Math.min(1, d / max);
    return 'hsla(' + (35 - 25 * t) + ',85%,' + (62 - 22 * t) + '%,' + a + ')';
  }

  function itemPath(it) {
    ctx.beginPath();
    placed(it).forEach(function (l) { l.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); });
  }

  // Rotate handle: just above the tool's top edge.
  function rotHandle(it) {
    var lp = placed(it)[0], top = Infinity;
    lp.forEach(function (p) { top = Math.min(top, p[1]); });
    return [it.x, top - L.clearance - 12 / vt().s];
  }

  function drawLayout(dpr) {
    var W = TT.binSize(L.nx), H = TT.binSize(L.ny), v = world(dpr), pcs = TT.pieces(L);
    ctx.beginPath();
    pcs.forEach(function (pc) { roundRectPath(pc.ix * G.pitch, pc.iy * G.pitch, TT.binSize(pc.kx), TT.binSize(pc.ky), G.radius); });
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#d6d6d2'; ctx.lineWidth = 1 / v.s; ctx.setLineDash([4 / v.s, 4 / v.s]);
    ctx.beginPath();
    for (var gx = 1; gx < L.nx; gx++) { ctx.moveTo(gx * G.pitch - 0.25, 0); ctx.lineTo(gx * G.pitch - 0.25, H); }
    for (var gy = 1; gy < L.ny; gy++) { ctx.moveTo(0, gy * G.pitch - 0.25); ctx.lineTo(W, gy * G.pitch - 0.25); }
    ctx.stroke(); ctx.setLineDash([]);
    // Wall margin.
    ctx.strokeStyle = 'rgba(180,35,24,0.25)'; ctx.lineWidth = 1 / v.s;
    ctx.strokeRect(L.wall, L.wall, W - 2 * L.wall, H - 2 * L.wall);
    // Pockets: clearance band (round-joined stroke) + the tool itself.
    L.items.slice().sort(function (a, b) { return a.depth - b.depth; }).forEach(function (it) {
      itemPath(it);
      ctx.lineJoin = 'round';
      if (L.clearance > 0) { ctx.strokeStyle = depthColour(it.depth, 0.45); ctx.lineWidth = 2 * L.clearance; ctx.stroke(); }
      ctx.fillStyle = depthColour(it.depth, 0.8); ctx.fill('evenodd');
      ctx.strokeStyle = it.uid === S.sel ? '#1c7ed6' : 'rgba(0,0,0,0.55)'; ctx.lineWidth = (it.uid === S.sel ? 2.5 : 1) / v.s; ctx.stroke();
    });
    L.notches.forEach(function (n) {
      if (n.item && !itemById(n.item)) return;
      var on = n.id === S.selNotch;
      drawNotch(notchWorld(n), depthColour(notchDepth(n), 0.6), on ? '#1c7ed6' : 'rgba(0,0,0,0.5)', v, on);
    });
    // Symmetry axes of tools that have one (pink, dashed).
    L.items.forEach(function (it2) {
      var ax = S.lib[it2.shapeId] && S.lib[it2.shapeId].axis;
      if (!ax || (it2.uid !== S.sel && S.layTool !== 'notch')) return;
      var p0 = toWorldItem(it2, ax.p), p1 = toWorldItem(it2, [ax.p[0] + Math.cos(ax.a * Math.PI / 180), ax.p[1] + Math.sin(ax.a * Math.PI / 180)]);
      var lp = placed(it2)[0], bb = [Infinity, Infinity, -Infinity, -Infinity];
      lp.forEach(function (p) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); });
      drawAxis({ p: p0, a: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI }, bb, v);
    });
    // Notch preview: where a click would put it (and its mirror twin).
    if (S.layTool === 'notch' && S.notchPrev) {
      var np = S.notchPrev, nn = newNotch();
      ctx.save(); ctx.setLineDash([4 / v.s, 3 / v.s]);
      [{ pos: np.pos, ang: np.ang }].concat(np.mirror ? [np.mirror] : []).forEach(function (q) {
        drawNotch({ x: q.pos[0], y: q.pos[1], d: nn.d, len: nn.len, ang: q.ang }, 'rgba(28,126,214,0.15)', np.item ? '#1c7ed6' : '#666', v);
      });
      ctx.restore();
    }
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5 / v.s;
    ctx.beginPath();
    pcs.forEach(function (pc) { roundRectPath(pc.ix * G.pitch, pc.iy * G.pitch, TT.binSize(pc.kx), TT.binSize(pc.ky), G.radius); });
    ctx.stroke();
    var it = selItem();
    if (it) {
      var hpt = rotHandle(it);
      ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = 1.5 / v.s;
      ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(hpt[0], hpt[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(hpt[0], hpt[1], 7 / v.s, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    }
    if (!L.items.length) message(dpr, S.libOrder.length ? 'Click “Add” next to a library shape.' : 'Trace some tools in Capture first.');
    drawRuler();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawModel(dpr, cw, ch) {
    if (!S.preview) { message(dpr, L.items.length ? 'Press “Generate model”.' : 'Place some tools in Layout first.'); return; }
    S.preview.draw(ctx, cw, ch);
  }

  // ---------- Pointer ----------

  function hitItem(p) {
    var v = vt();
    for (var k = L.items.length - 1; k >= 0; k--) {
      var it = L.items[k], loops = placed(it);
      if (TT.pointInLoop(p, loops[0])) return it;
      var near = loops[0].some(function (q, i) {
        var r = loops[0][(i + 1) % loops[0].length], dx = r[0] - q[0], dy = r[1] - q[1], l2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2));
        return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy) < 5 / v.s;
      });
      if (near) return it;
    }
    return null;
  }

  function hitNotch(p) {
    for (var k = L.notches.length - 1; k >= 0; k--) {
      var n = L.notches[k];
      if (n.item && !itemById(n.item)) continue;
      if (TT.notchDist(notchWorld(n), p) <= 0) return n;
    }
    return null;
  }

  cv.addEventListener('pointerdown', function (e) {
    cv.focus();
    var p = toWorld(e), v = vt();
    var panTool = S.phase === 'capture' && S.capView === 'trace' && S.capTool === 'pan';
    if (e.button === 1 || e.button === 2 || (S.space || panTool) && e.button === 0) { // pan
      if (S.phase !== 'generate') { S.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }; v.fit = false; cv.setPointerCapture(e.pointerId); }
      return;
    }
    if (S.phase === 'generate') {
      if (S.preview) { S.drag = { orbit: true, sx: e.clientX, sy: e.clientY, yaw: S.preview.yaw, pitch: S.preview.pitch }; cv.setPointerCapture(e.pointerId); }
      return;
    }
    if (S.phase === 'capture' && S.capView === 'photo' && S.corners) {
      var best = -1, bd = 30 / v.s, inArea = false;
      S.corners.forEach(function (c, i) { var d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      if (S.area) S.area.forEach(function (c, i) { var d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; inArea = true; } });
      if (best < 0) return;
      var set = inArea ? S.area : S.corners;
      S.drag = { corner: best, area: inArea, dx: set[best][0] - p[0], dy: set[best][1] - p[1] };
    } else if (S.phase === 'capture' && S.capView === 'trace' && S.warp) {
      if (S.capTool === 'select') {
        var sh = S.cSel, tol = 8 / v.s;
        if (sh) {
          // Grab a node, or click the selected outline to add a smooth node there and drag it.
          var hitN = hitNode(sh, p, tol);
          if (!hitN) {
            for (var li = 0; li < sh.nodes.length && !hitN; li++) {
              var near = TT.nearestOnPath(sh.nodes[li], p);
              if (near.d < tol) {
                capEdit();
                sh.nodes = JSON.parse(JSON.stringify(sh.nodes));
                var loop = sh.nodes[li], prev = loop[near.k];
                loop.splice(near.k + 1, 0, { x: near.pt[0], y: near.pt[1], c: false, s: prev.s });
                nodesEdited(sh);
                hitN = { loop: li, k: near.k + 1, added: true };
              }
            }
          }
          if (hitN) {
            S.selNode = { loop: hitN.loop, k: hitN.k };
            S.drag = { node: hitN, moved: !!hitN.added };
            renderShapeList(); draw();
            cv.setPointerCapture(e.pointerId);
            return;
          }
        }
        var hitS = null;
        S.shapes.forEach(function (s) { if (TT.pointInLoop(p, s.path[0]) && (!hitS || s.traced.area < hitS.traced.area)) hitS = s; });
        selectShape(hitS);
        return;
      }
      // Brush size is in screen pixels (like LaserEngraver), stored as mm.
      S.stroke = { mode: S.capTool, r: +(S.brush / 2 / v.s).toFixed(3), pts: [p] };
      S.drag = { stroke: true, sx: e.clientX, sy: e.clientY };
      draw();
    } else if (S.phase === 'layout') {
      if (S.layTool === 'notch') {
        var hn = hitNotch(p);
        if (hn) removeNotch(hn); else addNotch(notchTarget(p, e.altKey));
        S.notchPrev = null;
        layoutChanged(true); // notches near the edge may need a bigger bin
        return;
      }
      var it = selItem();
      if (it) {
        var hp = rotHandle(it);
        if (Math.hypot(hp[0] - p[0], hp[1] - p[1]) < 10 / v.s) {
          S.drag = { rotate: it, a0: Math.atan2(p[1] - it.y, p[0] - it.x), rot0: it.rot };
          cv.setPointerCapture(e.pointerId);
          return;
        }
      }
      // Notches sit on top of tools, so they win the click.
      var hitN = hitNotch(p), hitI = hitN ? null : hitItem(p);
      S.sel = hitI ? hitI.uid : null;
      S.selNotch = hitN ? hitN.id : null;
      syncSel();
      if (hitI || hitN) S.drag = { move: hitI || hitN, last: p, moved: false };
      draw();
    } else return;
    cv.setPointerCapture(e.pointerId);
  });

  cv.addEventListener('pointermove', function (e) {
    var d = S.drag, rect = cv.getBoundingClientRect();
    S.mouse = [e.clientX - rect.left, e.clientY - rect.top];
    if (!d) {
      if (S.phase === 'capture' && S.capView === 'trace' && STROKE_COLORS[S.capTool]) draw();
      if (S.phase === 'layout' && S.layTool === 'notch') {
        var wp2 = toWorld(e);
        S.notchPrev = hitNotch(wp2) ? null : notchTarget(wp2, e.altKey);
        draw();
      }
      return;
    }
    if (d.pan) { var v = vt(); v.x = d.vx + e.clientX - d.sx; v.y = d.vy + e.clientY - d.sy; draw(); return; }
    if (d.orbit) {
      S.preview.yaw = d.yaw + (e.clientX - d.sx) * 0.01;
      S.preview.pitch = Math.max(-0.2, Math.min(1.57, d.pitch + (e.clientY - d.sy) * 0.01));
      draw(); return;
    }
    var p = toWorld(e);
    if (d.node) {
      var sh = S.cSel;
      if (!d.moved) { capEdit(); sh.nodes = JSON.parse(JSON.stringify(sh.nodes)); d.moved = true; }
      var nd = sh.nodes[d.node.loop][d.node.k];
      nd.x = +p[0].toFixed(3); nd.y = +p[1].toFixed(3);
      nodesEdited(sh); draw();
    } else if (d.corner !== undefined) { (d.area ? S.area : S.corners)[d.corner] = [p[0] + d.dx, p[1] + d.dy]; draw(); }
    else if (d.stroke) {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) >= 3) { d.sx = e.clientX; d.sy = e.clientY; S.stroke.pts.push(p); }
      draw();
    }
    else if (d.rotate) {
      var a = Math.atan2(p[1] - d.rotate.y, p[0] - d.rotate.x), r = d.rot0 + (a - d.a0) * 180 / Math.PI;
      r = e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r * 2) / 2;
      d.rotate.rot = ((r + 540) % 360) - 180;
      C.selRot.set(d.rotate.rot); draw();
    } else if (d.move) {
      if (d.move.uid) { d.move.x += p[0] - d.last[0]; d.move.y += p[1] - d.last[1]; }
      else { var np = notchPos(d.move); moveNotch(d.move, [np[0] + p[0] - d.last[0], np[1] + p[1] - d.last[1]]); }
      d.last = p; d.moved = true; draw();
    }
  });

  cv.addEventListener('pointerup', function () {
    var d = S.drag;
    S.drag = null;
    if (!d) return;
    if (d.node) {
      var dsh = S.cSel, dn = dsh.nodes[d.node.loop][d.node.k];
      if (d.moved && axisSide(dsh, [dn.x, dn.y])) { nodesEdited(dsh, axisSide(dsh, [dn.x, dn.y])); S.selNode = null; }
      renderShapeList(); draw();
    }
    else if (d.corner !== undefined) { if (S.refMode === 'grid' && !d.area) fitGrid(); runFrom('warp'); }
    else if (d.stroke) { capEdit(); S.strokes.push(S.stroke); S.stroke = null; runFrom('edit'); toolbar(); }
    else if (d.rotate || (d.move && d.moved)) layoutChanged(true);
    else draw();
  });
  cv.addEventListener('pointerleave', function () { S.mouse = null; if (S.phase === 'capture') draw(); });
  cv.addEventListener('dblclick', function (e) {
    if (S.phase === 'layout' && (hitItem(toWorld(e)) || hitNotch(toWorld(e)))) return;
    if (S.phase === 'capture' && S.capView === 'trace' && S.capTool === 'select' && S.cSel) {
      var h = hitNode(S.cSel, toWorld(e), 8 / vt().s);
      if (h) { S.selNode = { loop: h.loop, k: h.k }; toggleCorner(); return; }
      if (TT.pointInLoop(toWorld(e), S.cSel.path[0])) return;
    }
    fitView();
  });

  function hitNode(sh, p, tol) {
    var best = null, bd = tol;
    sh.nodes.forEach(function (l, li) {
      l.forEach(function (nd, k) { var d = Math.hypot(nd.x - p[0], nd.y - p[1]); if (d <= bd) { bd = d; best = { loop: li, k: k }; } });
    });
    return best;
  }

  // Node edits on the selected node of the selected shape.
  function editNode(fn) {
    var sh = S.cSel, sn = S.selNode;
    if (!sh || !sn) return;
    capEdit();
    sh.nodes = JSON.parse(JSON.stringify(sh.nodes));
    var nd = sh.nodes[sn.loop][sn.k], side = axisSide(sh, [nd.x, nd.y]);
    fn(sh.nodes[sn.loop], sn.k);
    nodesEdited(sh, side);
    if (side) S.selNode = null; // node order changes when the other half is rebuilt
    renderShapeList(); draw();
  }
  function toggleCorner() { editNode(function (l, k) { l[k].c = !l[k].c; }); }
  function toggleStraight() { editNode(function (l, k) { l[k].s = !l[k].s; }); }
  function deleteNode() {
    var sh = S.cSel, sn = S.selNode;
    if (!sh || !sn || sh.nodes[sn.loop].length <= 3) return;
    editNode(function (l, k) { l.splice(k, 1); });
    S.selNode = null; draw();
  }

  function fitView() {
    var v = S.views[viewKey()];
    if (v) v.fit = true;
    if (S.preview && S.phase === 'generate') S.preview.zoom = 1;
    draw();
  }

  function zoomBy(k) {
    if (S.phase === 'generate') { if (S.preview) { S.preview.zoom *= k; draw(); } return; }
    var v = vt(), mx = cv.clientWidth / 2, my = cv.clientHeight / 2;
    v.fit = false; v.x = mx - (mx - v.x) * k; v.y = my - (my - v.y) * k; v.s *= k;
    draw();
  }

  // ---------- Undo / redo ----------

  // Capture: snapshots of the brush strokes and shape edits, taken before each change.
  function capState() { return { strokes: S.strokes.slice(), edits: JSON.stringify(S.edits) }; }
  function capEdit() {
    S.capHist.push(capState());
    if (S.capHist.length > 200) S.capHist.shift();
    S.capRedo = [];
  }
  function capRestore(h) {
    var strokesChanged = h.strokes.length !== S.strokes.length || h.strokes.some(function (s, i) { return s !== S.strokes[i]; });
    S.strokes = h.strokes; S.edits = JSON.parse(h.edits);
    S.selNode = null;
    runFrom(strokesChanged ? 'edit' : 'fit');
  }
  // Layout: snapshots after each change (see layoutChanged).
  S.layHist = []; S.layIdx = -1;
  function layoutSnapshot() {
    var s = JSON.stringify({ items: L.items, notches: L.notches, nx: L.nx, ny: L.ny, autoSize: L.autoSize, clearance: L.clearance, wall: L.wall });
    if (S.layHist[S.layIdx] === s) return;
    S.layHist = S.layHist.slice(0, S.layIdx + 1);
    S.layHist.push(s);
    if (S.layHist.length > 200) S.layHist.shift();
    S.layIdx = S.layHist.length - 1;
  }
  function layoutRestore(s) {
    var d = JSON.parse(s);
    Object.keys(d).forEach(function (k) { L[k] = d[k]; });
    if (!selItem()) S.sel = null;
    syncLayoutInputs(); invalidate(); save(); syncSel(); describeLayout(); draw();
  }

  function undo() {
    if (S.phase === 'capture') {
      var h = S.capHist.pop();
      if (!h) return;
      S.capRedo.push(capState());
      capRestore(h);
    } else if (S.phase === 'layout' && S.layIdx > 0) layoutRestore(S.layHist[--S.layIdx]);
  }

  function redo() {
    if (S.phase === 'capture') {
      var h = S.capRedo.pop();
      if (!h) return;
      S.capHist.push(capState());
      capRestore(h);
    } else if (S.phase === 'layout' && S.layIdx < S.layHist.length - 1) layoutRestore(S.layHist[++S.layIdx]);
  }

  // ---------- Keyboard (same keys as LaserEngraver where they exist; list in the Shortcuts dialog) ----------

  function setCapTool(t) {
    S.capTool = t;
    if (S.capView !== 'trace') S.capView = 'trace';
    toolbar(); draw();
  }

  document.addEventListener('keydown', function (e) {
    if ($('keys').open) return;
    var t = e.target, typing = t instanceof Element && t.matches('input[type=number], input[type=text], select, textarea');
    var ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && !typing) {
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); $('saveProject').click(); }
      else if (k === 'd' && S.phase === 'layout') { e.preventDefault(); $('dup').click(); }
      return;
    }
    if (typing || ctrl || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); S.space = true; cv.style.cursor = 'grab'; draw(); return; }
    if (e.key === '?') { $('keys').showModal(); return; }
    if (k === 'f' || e.key === '0') { fitView(); return; }
    if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
    if (e.key === '-') { zoomBy(0.8); return; }
    if (S.phase === 'capture') {
      var tool = CAP_TOOLS.find(function (c) { return c[2].toLowerCase() === k; });
      if (e.key === '1') { S.capView = 'photo'; toolbar(); draw(); }
      else if (e.key === '2') { S.capView = 'trace'; toolbar(); draw(); }
      else if (tool) setCapTool(tool[0]);
      else if (e.key === 'Escape') {
        if (S.selNode) { S.selNode = null; draw(); }
        else if (S.cSel) selectShape(null);
        else setCapTool('pan');
      }
      else if (k === 'x' && S.cSel) toggleOff(S.cSel);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selNode) { e.preventDefault(); deleteNode(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.cSel) { e.preventDefault(); toggleOff(S.cSel); }
      else if (k === 'c' && S.selNode) toggleCorner();
      else if (k === 'l' && S.selNode) toggleStraight();
      else if (e.key === '[' || e.key === ']') {
        S.brush = Math.min(120, Math.max(4, Math.round(S.brush * (e.key === ']' ? 1.2 : 1 / 1.2))));
        toolbar(); draw();
      } else if (e.key === 'Enter') addShapes();
      return;
    }
    if (S.phase === 'layout') {
      if (k === 'v') { S.layTool = 'select'; toolbar(); return; }
      if (k === 'n') { S.layTool = 'notch'; toolbar(); return; }
      if (e.key === 'Escape') { S.sel = null; S.selNotch = null; S.layTool = 'select'; toolbar(); syncSel(); draw(); return; }
      var sn = S.selNotch && L.notches.find(function (n) { return n.id === S.selNotch; });
      if (sn && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeNotch(sn); S.selNotch = null; layoutChanged(true); return; }
      var it = selItem();
      if (!it) return;
      var step = e.shiftKey ? 5 : 0.5, moved = true;
      if (e.key === 'ArrowLeft') it.x -= step;
      else if (e.key === 'ArrowRight') it.x += step;
      else if (e.key === 'ArrowUp') it.y -= step;
      else if (e.key === 'ArrowDown') it.y += step;
      else if (k === 'r') rotateSel(e.shiftKey ? -90 : 90);
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
      else moved = false;
      if (moved) { e.preventDefault(); if (e.key.indexOf('Arrow') === 0) layoutChanged(false); }
      return;
    }
    if (S.phase === 'generate' && k === 'g') generate();
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === ' ') { S.space = false; cv.style.cursor = ''; draw(); }
  });

  // ---------- Start ----------

  try { var stored = localStorage.getItem('tooltrace.v2'); if (stored) load(JSON.parse(stored)); } catch (e) { /* storage unavailable or corrupt */ }
  syncLayoutInputs(); renderLib(); describeLayout(); layoutSnapshot(); toolbar(); draw();
  TT.app = {
    S: S, L: L, C: C, runFrom: runFrom, setPhase: setPhase, addItem: addItem, generate: generate, fitGrid: fitGrid,
    selectShape: selectShape, draw: draw,
    setCapView: function (v) { S.capView = v; toolbar(); draw(); },
    setLayTool: function (t) { S.layTool = t; toolbar(); draw(); }
  };
})();
