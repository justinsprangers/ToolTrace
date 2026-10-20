/* ToolTrace UI: photo -> corners -> trace -> bin layout -> export. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d');
  var S = {
    view: 'photo', src: null, srcCanvas: null, corners: null, warp: null, warpCanvas: null,
    maskCanvas: null, seg: null, excluded: [], tool: null, pf: null, mode: 'move', autoCenter: true, drag: null, pending: {}
  };
  var D = { rot: 0, offX: 0, offY: 0, notches: [] };

  // ---------- Controls ----------

  function num(id) { return parseFloat($(id).value) || 0; }

  document.querySelectorAll('input[type=range]').forEach(function (r) {
    var out = r.parentNode.querySelector('output');
    var show = function () { out.textContent = r.value; };
    r.addEventListener('input', show); show();
  });

  function later(key, fn, ms) {
    clearTimeout(S.pending[key]);
    S.pending[key] = setTimeout(fn, ms);
  }

  function status(msg, warn) {
    $('status').textContent = msg;
    $('status').className = warn ? 'warn' : '';
  }

  function refSize() {
    var v = $('ref').value;
    $('customRef').hidden = v !== 'custom';
    if (v === 'custom') { var u = num('refUnit'); return [num('refW') * u, num('refH') * u]; }
    return v.split('x').map(Number);
  }

  ['ref', 'refW', 'refH', 'refUnit', 'ext'].forEach(function (id) {
    $(id).addEventListener('input', function () { refSize(); later('warp', runWarp, 250); });
  });
  ['threshold', 'lumWeight', 'open', 'close', 'minArea', 'margin', 'fillHoles'].forEach(function (id) {
    $(id).addEventListener('input', function () { setView('trace'); later('seg', runSegment, 200); });
  });
  ['clearance', 'depth', 'wall', 'nx', 'ny', 'units', 'maxUnits', 'notchD', 'autoUnits'].forEach(function (id) {
    $(id).addEventListener('input', function () { setView('bin'); later('bin', runBin, 80); });
  });
  $('rot').addEventListener('input', function () { D.rot = num('rot'); S.autoCenter = true; setView('bin'); later('bin', runBin, 80); });
  $('autoRot').onclick = function () { if (!S.tool) return; setRot(TT.bestRotation(S.tool)); };
  $('flip').onclick = function () { setRot((D.rot + 90) % 360); };
  $('center').onclick = function () { S.autoCenter = true; runBin(); };
  $('clearNotches').onclick = function () { D.notches = []; runBin(); };
  $('modeMove').onclick = function () { setMode('move'); };
  $('modeNotch').onclick = function () { setMode('notch'); };
  $('autoPaper').onclick = function () { if (S.src) { autoCorners(); runWarp(); } };
  $('resetCorners').onclick = function () { if (S.src) { defaultCorners(); setView('photo'); runWarp(); } };
  $('exportStl').onclick = exportStl;
  $('exportSvg').onclick = exportSvg;
  document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { setView(b.dataset.view); }; });

  function setRot(r) {
    D.rot = Math.round(r * 2) / 2;
    $('rot').value = D.rot;
    S.autoCenter = true;
    setView('bin');
    runBin();
  }

  function setMode(m) {
    S.mode = m;
    $('modeMove').classList.toggle('on', m === 'move');
    $('modeNotch').classList.toggle('on', m === 'notch');
    setView('bin');
  }

  function setView(v) {
    S.view = v;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    draw();
  }

  // ---------- Photo ----------

  $('file').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () { loadImage(img); URL.revokeObjectURL(img.src); };
    img.onerror = function () { status('Could not read that image.', true); };
    img.src = URL.createObjectURL(f);
    var base = f.name.replace(/\.[^.]+$/, '');
    if ($('name').value === 'tool') $('name').value = base;
  });

  function loadImage(img) {
    var k = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    S.srcCanvas = c;
    S.src = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    S.excluded = []; S.tool = null; D.notches = [];
    autoCorners();
    setView('photo');
    runWarp();
  }
  TT.loadImage = loadImage; // used by the test page

  function defaultCorners() {
    var w = S.src.width, h = S.src.height;
    S.corners = [[w * 0.2, h * 0.2], [w * 0.8, h * 0.2], [w * 0.8, h * 0.8], [w * 0.2, h * 0.8]];
  }

  function autoCorners() {
    var c = TT.detectPaper(S.src);
    if (c) S.corners = c;
    else { defaultCorners(); status('Couldn’t find the paper. Drag the 4 handles onto its corners.', true); }
  }

  // ---------- Pipeline ----------

  function runWarp() {
    if (!S.src || !S.corners) return;
    var ref = refSize(), ext = num('ext'), c = TT.orderCorners(S.corners), dims = TT.fitRef(c, ref[0], ref[1]);
    var res = Math.max(0.25, Math.sqrt((dims[0] + 2 * ext) * (dims[1] + 2 * ext) / 4e6));
    S.warp = TT.warp(S.src, c, dims[0], dims[1], ext, res);
    S.warpCanvas = toCanvas(S.warp.data, S.warp.w, S.warp.h);
    runSegment();
  }

  function runSegment() {
    if (!S.warp) return;
    var wp = S.warp, t0 = performance.now();
    var seg = TT.segment(wp, {
      threshold: num('threshold'), lumWeight: num('lumWeight'), open: num('open'), close: num('close'),
      minArea: num('minArea'), margin: num('margin'), fillHoles: $('fillHoles').checked
    });
    S.seg = { mask: seg.mask, comp: TT.components(seg.mask, wp.w, wp.h) };
    applySelection();
    if (S.tool) status('Traced ' + S.seg.comp.areas.length + ' shape(s) in ' + Math.round(performance.now() - t0) + ' ms. Click a shape in the Trace view to leave it out.');
  }

  // Component label (1-based) under a paper-mm point, or 0.
  function labelAt(x, y) {
    var wp = S.warp, i = Math.floor((x - wp.ox) / wp.res), j = Math.floor((y - wp.oy) / wp.res);
    if (i < 0 || j < 0 || i >= wp.w || j >= wp.h) return 0;
    return S.seg.comp.labels[j * wp.w + i];
  }

  // Shapes the user clicked to leave out are remembered as paper points, so they stay out
  // when the trace settings change.
  function applySelection() {
    var wp = S.warp, n = wp.w * wp.h, labels = S.seg.comp.labels, off = {};
    S.excluded.forEach(function (p) { var l = labelAt(p[0], p[1]); if (l) off[l] = 1; });
    var mask = new Uint8Array(n), over = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) {
      var l = labels[i];
      if (!l) continue;
      if (off[l]) { over[i * 4] = over[i * 4 + 1] = over[i * 4 + 2] = 60; over[i * 4 + 3] = 150; continue; }
      mask[i] = 1; over[i * 4] = 255; over[i * 4 + 1] = 40; over[i * 4 + 3] = 110;
    }
    S.maskCanvas = toCanvas(over, wp.w, wp.h);
    var hadTool = !!S.tool;
    S.tool = TT.toolFromMask(mask, wp.w, wp.h, wp.res, wp.ox, wp.oy);
    if (!S.tool) { S.pf = null; status('Nothing traced. Lower the sensitivity, check the corners, or click a grey shape to include it.', true); draw(); return; }
    if (!hadTool) { D.rot = TT.bestRotation(S.tool); $('rot').value = D.rot; }
    S.autoCenter = true;
    runBin();
  }

  function runBin() {
    if (!S.tool) { draw(); return; }
    D.tool = S.tool;
    D.clearance = num('clearance'); D.wall = num('wall'); D.notchD = num('notchD');
    D.maxUnits = Math.max(1, Math.round(num('maxUnits')));
    var fit = TT.autoFit(D);
    if ($('autoUnits').checked) { $('nx').value = fit.nx; $('ny').value = fit.ny; }
    D.nx = Math.max(1, Math.round(num('nx'))); D.ny = Math.max(1, Math.round(num('ny')));
    if (S.autoCenter) { D.offX = fit.offX; D.offY = fit.offY; }
    D.depth = Math.max(0.5, num('depth'));
    if ($('autoUnits').checked) $('units').value = TT.autoHeight(D.depth);
    D.units = Math.max(1, Math.round(num('units')));
    S.pf = TT.pocketField(D);
    describe();
    draw();
  }

  function describe() {
    var b = TT.rotatedBox(S.tool, D.rot), w = b[2] - b[0], h = b[3] - b[1], G = TT.GF;
    var floor = D.units * G.unitH - D.depth - G.baseH, pieces = TT.pieces(D), lines = [];
    lines.push('Tool: ' + w.toFixed(1) + ' × ' + h.toFixed(1) + ' mm (' + (w / 25.4).toFixed(2) + ' × ' + (h / 25.4).toFixed(2) + ' in)');
    lines.push('Bin: ' + D.nx + ' × ' + D.ny + ' units, ' + D.units + ' high = ' + TT.binSize(D.nx) + ' × ' + TT.binSize(D.ny) + ' × ' + D.units * G.unitH + ' mm');
    if (pieces.length > 1) lines.push('Prints as ' + pieces.length + ' pieces: ' + pieces.map(function (p) { return p.kx + '×' + p.ky; }).join(', '));
    var warn = [];
    if (floor < 0.6) warn.push('Pocket is too deep for this height: floor is ' + floor.toFixed(1) + ' mm. Add height units.');
    var minWall = wallLeft();
    if (minWall < D.wall - 0.05) warn.push('Pocket comes within ' + Math.max(0, minWall).toFixed(1) + ' mm of the bin edge.');
    $('binInfo').innerHTML = esc(lines.join('\n')) + (warn.length ? '\n<span class="warn">' + esc(warn.join('\n')) + '</span>' : '');
  }

  // Thinnest wall left between the pocket and the outside of the bin (whole bin, ignoring splits).
  function wallLeft() {
    var pf = S.pf, W = TT.binSize(D.nx), H = TT.binSize(D.ny), min = Infinity;
    for (var j = 0; j < pf.h; j++) for (var i = 0; i < pf.w; i++) {
      var v = pf.f[j * pf.w + i];
      if (v >= 0) continue;
      var x = -1 + i * pf.res, y = -1 + j * pf.res;
      var edge = Math.min(x, y, W - x, H - y);
      if (edge < min) min = edge;
    }
    return min;
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function toCanvas(data, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return c;
  }

  // ---------- Drawing ----------

  var VT = { s: 1, x: 0, y: 0 }; // screen = world * s + (x, y)

  function fit(w, h, pad) {
    var cw = cv.clientWidth, ch = cv.clientHeight;
    VT.s = Math.min((cw - 2 * pad) / w, (ch - 2 * pad) / h);
    VT.x = (cw - w * VT.s) / 2; VT.y = (ch - h * VT.s) / 2;
  }

  function toWorld(e) {
    var r = cv.getBoundingClientRect();
    return [(e.clientX - r.left - VT.x) / VT.s, (e.clientY - r.top - VT.y) / VT.s];
  }

  function draw() {
    var dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9e9e6'; ctx.fillRect(0, 0, cw, ch);
    if (S.view === 'photo') drawPhoto();
    else if (S.view === 'trace') drawTrace();
    else drawBin();
  }

  function world(dpr) { ctx.setTransform(dpr * VT.s, 0, 0, dpr * VT.s, dpr * VT.x, dpr * VT.y); }

  function drawPhoto() {
    if (!S.src) return;
    var dpr = window.devicePixelRatio || 1;
    fit(S.src.width, S.src.height, 12);
    world(dpr);
    ctx.drawImage(S.srcCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = TT.orderCorners(S.corners).map(function (p) { return [p[0] * VT.s + VT.x, p[1] * VT.s + VT.y]; });
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 2;
    ctx.beginPath(); c.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); ctx.stroke();
    S.corners.forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0] * VT.s + VT.x, p[1] * VT.s + VT.y, 9, 0, 7);
      ctx.fillStyle = 'rgba(232,89,12,0.35)'; ctx.fill(); ctx.stroke();
    });
    if (S.drag && S.drag.corner !== undefined) drawLoupe(S.corners[S.drag.corner], dpr);
  }

  // Magnified view of the area around a dragged corner, in the canvas's top-left.
  function drawLoupe(p, dpr) {
    var size = 170, zoom = 4, r = size / zoom / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(10, 10, size, size); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.srcCanvas, p[0] - r, p[1] - r, 2 * r, 2 * r, 10, 10, size, size);
    ctx.restore();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(10, 10, size, size);
    ctx.strokeStyle = '#e8590c';
    ctx.beginPath(); ctx.moveTo(10 + size / 2, 10); ctx.lineTo(10 + size / 2, 10 + size);
    ctx.moveTo(10, 10 + size / 2); ctx.lineTo(10 + size, 10 + size / 2); ctx.stroke();
  }

  function drawTrace() {
    if (!S.warp) return;
    var dpr = window.devicePixelRatio || 1, wp = S.warp;
    fit(wp.w * wp.res, wp.h * wp.res, 12);
    world(dpr);
    ctx.translate(-wp.ox, -wp.oy); // from here on, units are paper mm
    ctx.save();
    ctx.translate(wp.ox, wp.oy); ctx.scale(wp.res, wp.res);
    ctx.drawImage(S.warpCanvas, 0, 0);
    ctx.drawImage(S.maskCanvas, 0, 0);
    ctx.restore();
    if (S.tool) {
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5 / VT.s;
      ctx.beginPath();
      S.tool.loops.forEach(function (l) { l.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); });
      ctx.stroke();
    }
    drawRuler(dpr);
  }

  // 50 mm scale bar.
  function drawRuler(dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var len = 50 * VT.s, x = 16, y = cv.clientHeight - 16;
    ctx.fillStyle = '#222'; ctx.fillRect(x, y - 3, len, 3);
    ctx.font = '12px system-ui'; ctx.fillText('50 mm', x, y - 7);
  }

  function drawBin() {
    if (!S.tool || !S.pf) return;
    var dpr = window.devicePixelRatio || 1, W = TT.binSize(D.nx), H = TT.binSize(D.ny), G = TT.GF, pf = S.pf, wp = S.warp;
    fit(W, H, 30);
    world(dpr);
    var pieces = TT.pieces(D);
    ctx.save();
    ctx.beginPath();
    pieces.forEach(function (pc) { roundRectPath(pc.ix * G.pitch, pc.iy * G.pitch, TT.binSize(pc.kx), TT.binSize(pc.ky), G.radius); });
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.clip();
    // Photo of the tool, placed the way it sits in the bin.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(W / 2 + D.offX, H / 2 + D.offY);
    ctx.rotate(D.rot * Math.PI / 180);
    ctx.translate(-S.tool.cx + wp.ox, -S.tool.cy + wp.oy);
    ctx.scale(wp.res, wp.res);
    ctx.drawImage(S.warpCanvas, 0, 0);
    ctx.restore();
    // Grid cells.
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.4; ctx.setLineDash([2, 2]);
    for (var gx = 1; gx < D.nx; gx++) { ctx.beginPath(); ctx.moveTo(gx * G.pitch - 0.25, 0); ctx.lineTo(gx * G.pitch - 0.25, H); ctx.stroke(); }
    for (var gy = 1; gy < D.ny; gy++) { ctx.beginPath(); ctx.moveTo(0, gy * G.pitch - 0.25); ctx.lineTo(W, gy * G.pitch - 0.25); ctx.stroke(); }
    ctx.setLineDash([]);
    // Pocket.
    ctx.beginPath();
    TT.contours(pf.f, pf.w, pf.h).forEach(function (l) {
      l.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](-1 + p[0] * pf.res, -1 + p[1] * pf.res); });
      ctx.closePath();
    });
    ctx.fillStyle = 'rgba(232,89,12,0.25)'; ctx.fill('evenodd');
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.restore();
    // Piece outlines.
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    pieces.forEach(function (pc) { roundRectPath(pc.ix * G.pitch, pc.iy * G.pitch, TT.binSize(pc.kx), TT.binSize(pc.ky), G.radius); });
    ctx.stroke();
    ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = 0.5;
    D.notches.forEach(function (n) { ctx.beginPath(); ctx.arc(n[0], n[1], D.notchD / 2, 0, 7); ctx.stroke(); });
    drawRuler(dpr);
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.addEventListener('resize', draw);

  // ---------- Pointer ----------

  cv.addEventListener('pointerdown', function (e) {
    var p = toWorld(e);
    if (S.view === 'photo' && S.corners) {
      var best = -1, bd = 30 / VT.s;
      S.corners.forEach(function (c, i) { var d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return;
      S.drag = { corner: best, dx: S.corners[best][0] - p[0], dy: S.corners[best][1] - p[1] };
    } else if (S.view === 'trace' && S.seg) {
      var x = p[0] + S.warp.ox, y = p[1] + S.warp.oy, l = labelAt(x, y);
      if (!l) return;
      var before = S.excluded.length;
      S.excluded = S.excluded.filter(function (q) { return labelAt(q[0], q[1]) !== l; });
      if (S.excluded.length === before) S.excluded.push([x, y]);
      S.tool = null; // re-pick the rotation for the new selection
      applySelection();
      return;
    } else if (S.view === 'bin' && S.tool) {
      if (S.mode === 'notch') {
        var hit = D.notches.findIndex(function (n) { return Math.hypot(n[0] - p[0], n[1] - p[1]) < D.notchD / 2; });
        if (hit >= 0) D.notches.splice(hit, 1); else D.notches.push(p);
        runBin();
        return;
      }
      S.drag = { last: p };
    } else return;
    cv.setPointerCapture(e.pointerId);
  });

  cv.addEventListener('pointermove', function (e) {
    if (!S.drag) return;
    var p = toWorld(e);
    if (S.drag.corner !== undefined) {
      S.corners[S.drag.corner] = [p[0] + S.drag.dx, p[1] + S.drag.dy];
      draw();
    } else {
      D.offX += p[0] - S.drag.last[0]; D.offY += p[1] - S.drag.last[1];
      S.drag.last = p; S.autoCenter = false;
      later('bin', runBin, 30);
    }
  });

  cv.addEventListener('pointerup', function () {
    if (!S.drag) return;
    var wasCorner = S.drag.corner !== undefined;
    S.drag = null;
    if (wasCorner) runWarp(); else draw();
  });

  // ---------- Export ----------

  function download(name, data, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function fileBase() { return ($('name').value || 'tool').replace(/[^\w.-]+/g, '_'); }

  // Builds every piece and checks each shell is closed. Exposed for testing.
  TT.buildAll = function () {
    var pieces = TT.pieces(D), problems = [];
    var meshes = pieces.map(function (pc, k) {
      var m = TT.pieceMesh(D, S.pf, pc);
      var open = 0;
      m.shells.forEach(function (s) { open += TT.openEdges(s); });
      if (open || m.missingArea > 1) problems.push('piece ' + (k + 1) + ': ' + open + ' open edges, ' + m.missingArea.toFixed(1) + ' mm² untriangulated');
      return { pc: pc, shells: m.shells };
    });
    return { meshes: meshes, problems: problems };
  };

  function exportStl() {
    if (!S.pf) { status('Trace a tool first.', true); return; }
    status('Building mesh…');
    setTimeout(function () {
      var out = TT.buildAll(), many = out.meshes.length > 1;
      out.meshes.forEach(function (m, k) {
        var name = fileBase() + '_' + m.pc.kx + 'x' + m.pc.ky + 'x' + D.units + (many ? '_part' + (k + 1) : '') + '.stl';
        setTimeout(function () { download(name, TT.stl(m.shells), 'model/stl'); }, k * 400);
      });
      if (out.problems.length) status('Exported, but the mesh check found problems (' + out.problems.join('; ') + '). Check it in your slicer.', true);
      else status('Exported ' + out.meshes.length + ' STL file(s). Mesh check passed.');
    }, 20);
  }

  function exportSvg() {
    if (!S.pf) { status('Trace a tool first.', true); return; }
    download(fileBase() + '_outline.svg', TT.svg(D, S.pf), 'image/svg+xml');
  }

  TT.state = S; TT.design = D; // for testing from the console
  TT.app = { runWarp: runWarp, runSegment: runSegment, applySelection: applySelection, setView: setView };
  draw();
})();
