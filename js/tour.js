/* ToolTrace tutorial: a guided tour through Capture -> Layout -> Generate. Each step dims the
   page, spotlights one control and explains it in a small card (Back / Next / End). It can load a
   built-in sample photo (two tools on letter paper, drawn here) so it works without a photo.
   Starts by itself on the first visit; the Tutorial button replays it. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A = function () { return TT.app; };
  var q = function (sel) { return document.querySelector(sel); };

  // ---------- Sample photo ----------

  // Letter paper photographed at a slight angle on a wooden bench, with an open/box-end wrench and
  // a screwdriver on it. Drawn in paper mm and mapped into the photo through a homography.
  TT.samplePhoto = function () {
    var W = 2400, H = 1800, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#8a6a4a'); grad.addColorStop(1, '#6e5238');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    for (var i = 0; i < 60; i++) { // wood grain
      g.strokeStyle = 'rgba(40,25,10,' + (0.05 + 0.05 * Math.random()) + ')'; g.lineWidth = 2 + 6 * Math.random();
      var y = Math.random() * H; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W / 3, y + 30, 2 * W / 3, y - 30, W, y + 10); g.stroke();
    }
    var Hm = TT.homography([[0, 0], [215.9, 0], [215.9, 279.4], [0, 279.4]], [[760, 230], [1700, 270], [1760, 1560], [690, 1520]]);
    var P = function (p) { return TT.applyH(Hm, p[0], p[1]); };
    function path(loops) {
      g.beginPath();
      loops.forEach(function (l) { l.forEach(function (p, k) { var s = P(p); g[k ? 'lineTo' : 'moveTo'](s[0], s[1]); }); g.closePath(); });
    }
    function circle(cx, cy, r, rev) {
      var pts = [];
      for (var k = 0; k < 72; k++) { var a = (rev ? -1 : 1) * k / 72 * 2 * Math.PI; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return pts;
    }
    // A tool = filled parts (overlapping is fine) plus cut-outs in paper colour, with a soft shadow.
    function tool(parts, cuts) {
      g.save(); g.translate(10, 14); g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,0.18)';
      parts.forEach(function (pt) { path([pt[0]]); g.fill(); });
      g.restore();
      parts.forEach(function (pt) { path([pt[0]]); g.fillStyle = pt[1]; g.fill(); });
      (cuts || []).forEach(function (ct) { path([ct]); g.fillStyle = '#f4f2ec'; g.fill(); });
    }
    function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
    path([rect(0, 0, 215.9, 279.4)]); g.fillStyle = '#f4f2ec'; g.fill();
    // Combination wrench: open-end head with a jaw gap, handle, box end with a hole.
    var steel = '#50565c';
    tool([[circle(65, 52, 20), steel], [rect(58, 60, 72, 212), steel], [circle(65, 222, 16), steel]],
      [rect(57, 22, 73, 50), circle(65, 222, 7)]);
    // Screwdriver: rounded red handle, grey shaft with a flat tip.
    var red = '#c0392b', shaft = '#8c939a', hnd = circle(160, 55, 15).filter(function (p) { return p[1] <= 55; });
    tool([[hnd.concat([[175, 55], [175, 140], [168, 148], [152, 148], [145, 140], [145, 55]]), red],
      [[[156, 146], [164, 146], [164, 245], [166, 255], [154, 255], [156, 245]], shaft]]);
    return c;
  };

  // ---------- Steps ----------

  function hasShapes() { return A().S.shapes && A().S.shapes.length; }
  function biggestShape() {
    var best = null;
    (A().S.shapes || []).forEach(function (sh) { if (!sh.off && (!best || sh.traced.area > best.traced.area)) best = sh; });
    return best;
  }

  var STEPS = [
    { title: 'Welcome to ToolTrace', html:
      '<p>Fit any drawer or shelf with Gridfinity, start to finish:</p>' +
      '<ol><li><b>Drawer</b>: measure the space</li><li><b>Baseplate</b>: printed or laser-cut</li><li><b>Bins</b>: plan them on the grid</li><li><b>Make</b>: everything to print or cut</li></ol>' +
      '<p>Bins with pockets shaped like your tools use the <b>Tool bin</b> steps: Capture, Layout, Generate.</p>', phase: 'drawer' },
    { target: 'details[data-key=drawer]', title: '1. Drawer', html:
      '<ul><li>Inside width, depth and height, at the narrowest point.</li><li>The picture shows how many 42 mm cells fit.</li></ul>', phase: 'drawer' },
    { target: '#drPlate', title: 'Baseplate type', html:
      '<ul><li><b>3D printed</b>: ultralight pieces sized for your bed.</li><li><b>Laser-cut</b>: one sheet with a hole per cell.</li><li><b>None</b>: bins sit loose.</li></ul>', phase: 'drawer' },
    { target: 'details[data-key=bpArea]', title: '2. Baseplate', html:
      '<ul><li><b>Pad edges</b> fills the drawer exactly; <b>one corner</b> keeps more pieces standard.</li><li><b>Max print size</b> is your bed size.</li><li>Print the <b>test piece</b> first.</li></ul>', phase: 'baseplate' },
    { target: 'details[data-key=binDesigns]', title: '3. Bin designs', html:
      '<ul><li><b>+ Standard bin</b> or <b>+ Tool bin</b> makes a design; it isn’t in the drawer yet.</li><li>Click a design for its size, compartments, label tab, scoop and lip.</li><li><b>Place</b> (or drag it onto the drawer) puts in a copy; place as many as you like.</li></ul>', phase: 'bins' },
    { target: 'details[data-key=bins]', title: 'Bins in the drawer', html:
      '<ul><li>Click a bin, then <kbd>R</kbd> rotates it; drag to move, <kbd>Delete</kbd> takes it out.</li><li>Drag across empty cells for a plain bin; <b>Fill empty cells</b> does the rest.</li><li>Bins too tall for the drawer, or overlapping, turn red.</li></ul>', phase: 'bins' },
    { target: 'details[data-key=make]', title: '4. Make', wait: 2000, html:
      '<ul><li>Test pieces first, then the baseplate and bins, with counts.</li><li><b>Bambu 3MF</b>: every print on plates in one file. Or a zip of STLs.</li><li>Tick things off as you finish them.</li></ul>', phase: 'make' },
    { title: 'Tool bins', html:
      '<p>A bin with a pocket shaped like each tool, in three steps:</p>' +
      '<ol><li><b>Capture</b>: trace tools from a photo</li><li><b>Layout</b>: arrange them in a bin</li><li><b>Generate</b>: check the model</li></ol>' +
      '<p class="tour-note">In Bins, <b>+ Tool bin</b> starts one. <b>Done ← Bins</b> (top) saves it as a design to place.</p>' +
      '<div class="tour-acts"><button class="b primary" data-act="sample">Try it with a sample photo</button><button class="b" data-act="next">Use my own photo</button></div>',
      phase: 'capture', noNext: true },
    { target: 'details[data-key=photo]', title: 'Choose a photo', html:
      '<ul><li>Tools lying flat on plain white paper work best.</li><li>Shoot straight down; several tools per photo is fine.</li></ul>', phase: 'capture' },
    { target: 'details[data-key=ref]', title: 'Set the scale', before: function () { A().setCapView('photo'); }, html:
      '<ul><li><b>Paper</b>: picks a paper size; corners are found automatically.</li><li><b>Grid mat</b>: detects a cutting mat’s grid.</li><li><b>4 points</b>: any rectangle you know the size of.</li></ul>', phase: 'capture' },
    { target: '#cv', title: 'Check the handles', before: function () { A().setCapView('photo'); }, html:
      '<ul><li>The orange handles should sit on the paper corners; drag them if not.</li><li>Scroll to zoom, right-drag to pan, double-click to fit.</li></ul>', phase: 'capture' },
    { target: '#useArea', parent: 'label', title: 'Optional: work area', html:
      '<ul><li>Green handles mark where the tools are; only that area is traced.</li><li>Handy when tools hang off the paper, or to skip clutter.</li></ul>', phase: 'capture' },
    { target: '#cv', title: 'The traced outlines', before: function () { A().setCapView('trace'); }, html:
      '<ul><li><b>Yellow</b>: each traced tool, with its size underneath.</li><li><b>Cyan dots</b>: corners that stay sharp.</li></ul>', phase: 'capture' },
    { target: 'details[data-key=trace]', title: 'Trace settings', open: true, html:
      '<ul><li>Usually fine as they are, so this section starts folded.</li><li>The blue tick on a slider is its default; ↺ or <b>Restore defaults</b> puts it back.</li></ul>', phase: 'capture' },
    { target: '#tbTool', title: 'Fix the trace with brushes', before: function () { A().setCapView('trace'); }, html:
      '<ul><li><b>Brush keep</b> (B) adds what you paint, <b>Brush erase</b> (E) removes it, e.g. the gap between snip handles.</li><li><kbd>[</kbd> <kbd>]</kbd> change the brush size, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.</li></ul>', phase: 'capture' },
    { target: 'details[data-key=shapes]', title: 'Your shapes', html:
      '<ul><li>Untick a shape (or select it and press <kbd>Delete</kbd>) to leave it out.</li><li>Click a shape to select it.</li></ul>', phase: 'capture' },
    { target: '#cv', title: 'Edit the outline with nodes', before: function () { A().setCapView('trace'); var b = biggestShape(); if (b) A().selectShape(b); }, html:
      '<ul><li>■ corner, ● smooth. Drag a node to move it.</li><li>Click the outline to add a node; double-click (or <kbd>C</kbd>) switches corner / smooth.</li><li><kbd>Delete</kbd> removes the selected node.</li></ul>', phase: 'capture' },
    { target: '#shapeSel', title: 'Per-shape options', html:
      '<ul><li><b>Symmetric</b>: averages both halves across an axis, so the outline is exactly symmetric.</li><li><b>Own outline settings</b>: change just this shape.</li></ul>', phase: 'capture' },
    { target: 'details[data-key=save]', title: 'Save to your library', html:
      '<ul><li>Set the pocket depth (how deep the tool sits).</li><li><b>Add selected</b>: one shape, under its own name.</li><li><b>Add all ticked</b>: every shape, named “prefix + shape name”.</li></ul>' +
      '<div class="tour-acts"><button class="b" data-act="addall">Add all for me</button></div>', phase: 'capture' },
    { target: 'details[data-key=lib]', title: 'Layout: the library', before: function () {
      if (!tourIds().length && hasShapes()) $('addShapes').click();
      A().setPhase('layout');
    }, html:
      '<ul><li><b>Add</b> puts a shape in the bin.</li><li>Tick several and <b>Delete ticked</b> to clean up.</li></ul>', phase: 'layout' },
    { target: '#cv', title: 'Arrange the bin', before: function () {
      A().setPhase('layout'); A().setLayTool('select');
      tourBin();
    }, html:
      '<ul><li>Drag a tool to move it; drag its round handle to rotate (<kbd>Shift</kbd> snaps 15°).</li><li>Arrows nudge, <kbd>R</kbd> rotates 90°, <kbd>Delete</kbd> removes.</li><li>The bin grows to fit (42 mm Gridfinity cells).</li></ul>', phase: 'layout' },
    { target: 'details[data-key=bin]', title: 'Bin settings', html:
      '<ul><li><b>Clearance</b>: gap around each tool (1 mm is a good start).</li><li><b>Min wall</b>: material left at the bin edge.</li></ul>', phase: 'layout' },
    { target: 'details[data-key=notch]', title: 'Finger notches', before: function () { A().setLayTool('notch'); }, html:
      '<ul><li>With <b>Notch</b> (N) on, a dashed preview follows the mouse and snaps to tool edges.</li><li>Circle or slot; symmetric tools get a mirrored twin.</li><li>Click a notch in Select mode, then <kbd>Delete</kbd> to remove it.</li></ul>', phase: 'layout' },
    { target: 'details[data-key=model]', title: 'Generate: the model', before: function () { A().setLayTool('select'); A().setPhase('generate'); }, html:
      '<ul><li>Height comes from the deepest pocket.</li><li><b>Pocket edge chamfer</b> bevels the pocket tops so tools drop in.</li><li><b>Max units per print</b>: 6 fits a 256 mm bed; bigger bins are split.</li></ul>', phase: 'generate' },
    { target: '#cv', title: '3D preview', before: function () { tourBin(); A().setPhase('generate'); if (A().L.items.length && !A().S.gen) A().generate(); }, wait: 1500, html:
      '<ul><li><b>Generate model</b> builds it and checks the mesh.</li><li>Drag to turn, scroll to zoom.</li></ul>', phase: 'generate' },
    { target: 'details[data-key=dl]', title: 'Download', html:
      '<ul><li>One STL per printable piece, sizes in mm and inches.</li><li>Also a 1:1 SVG of the pockets (for laser-cut foam).</li></ul>', phase: 'generate' },
    { title: 'You’re set', html:
      '<ul><li><b>Save project</b> backs up the whole drawer: size, baseplate, bins, tool library and checklist.</li><li>Press <kbd>?</kbd> for every keyboard shortcut.</li><li><b>Tutorial</b> (top right) replays this tour.</li></ul>' +
      '<p class="tour-note">Your own bin comes back when the tour ends' + '<span id="tourSampleNote" hidden>, and the sample tools are removed from the library</span>.</p>' }
  ];

  // The tour works on its own bin: the tools added to the library during this run (the sample's,
  // or the user's own photo), never what was already there. The user's bin and library are put
  // back when the tour ends.
  var saved = null; // {layout, libBefore: {id: 1}}
  function tourIds() {
    if (!saved) return [];
    return A().S.libOrder.filter(function (id) { return !saved.libBefore[id]; });
  }
  function tourBin() {
    var ids = tourIds(), L = A().L, inBin = {};
    L.items.forEach(function (it) { inBin[it.shapeId] = 1; });
    var ok = ids.length && L.items.length === ids.length && ids.every(function (id) { return inBin[id]; });
    if (ok) return;
    L.items = []; L.notches = []; L.autoSize = true;
    ids.forEach(function (id) { A().addItem(id); });
  }

  // ---------- Engine ----------

  var hi, dim, card, idx = 0, usedSample = false;

  function build() {
    dim = document.createElement('div'); dim.id = 'tourDim';
    document.body.appendChild(dim);
    hi = document.createElement('div'); hi.id = 'tourHi';
    card = document.createElement('div'); card.id = 'tourCard';
    card.innerHTML = '<div class="tour-step"></div><h3></h3><div class="tour-body"></div>' +
      '<div class="tour-nav"><button class="b" data-act="end">End</button><span></span><button class="b" data-act="back">Back</button><button class="b primary" data-act="next">Next</button></div>';
    document.body.appendChild(hi); document.body.appendChild(card);
    card.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === 'next') go(idx + 1);
      else if (act === 'back') go(idx - 1);
      else if (act === 'end') end();
      else if (act === 'sample') loadSample();
      else if (act === 'addall') { if (hasShapes()) $('addShapes').click(); go(idx + 1); }
    });
    window.addEventListener('resize', function () { if (TT.tourOpen) place(); });
  }

  function loadSample() {
    usedSample = true; TT.tourSample = true;
    q('#refMode [data-mode=paper]').click();
    $('paperSize').value = '215.9x279.4';
    A().S.edits = [];
    TT.loadImage(TT.samplePhoto(), 'sample');
    $('shapeName').value = 'Sample';
    setTimeout(function () { go(idx + 1); }, 400);
  }

  function targetEl(st) {
    if (!st.target) return null;
    var el = q(st.target);
    if (el && st.parent) el = el.closest(st.parent) || el;
    if (!el || el.hidden || !el.getClientRects().length) return null;
    return el;
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) { if (i >= STEPS.length) end(); return; }
    idx = i;
    var st = STEPS[i];
    if (st.phase && A().S.phase !== st.phase) A().setPhase(st.phase);
    try { if (st.before) st.before(); } catch (e) { console.error(e); }
    card.querySelector('.tour-step').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    card.querySelector('h3').textContent = st.title;
    card.querySelector('.tour-body').innerHTML = st.html;
    var nav = card.querySelector('.tour-nav');
    nav.querySelector('[data-act=back]').disabled = i === 0;
    nav.querySelector('[data-act=next]').hidden = !!st.noNext;
    nav.querySelector('[data-act=next]').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    var note = $('tourSampleNote');
    if (note) note.hidden = !usedSample;
    place();
    // Things like tracing and generating finish a moment later; place again once they have.
    setTimeout(place, 350);
    setTimeout(place, st.wait || 900);
  }

  // Spotlight the step's control (opening its section and scrolling it into view) and put the card
  // beside it, or centre the card when there's nothing to point at.
  function place() {
    var st = STEPS[idx], el = targetEl(st);
    if (el) {
      var sec = el.closest('details');
      if (sec && !sec.open && (st.open || el !== sec)) sec.open = true;
      if (st.open && el.tagName === 'DETAILS') el.open = true;
      el.scrollIntoView({ block: 'nearest' });
    }
    var vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, pad = 6;
    if (!el) { // nothing to point at: dim everything, card in the middle
      dim.style.clipPath = 'none'; hi.style.display = 'none';
      card.style.left = Math.max(12, (vw - cw) / 2) + 'px'; card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      return;
    }
    var r = el.getBoundingClientRect(), x0 = r.left - pad, y0 = r.top - pad, x1 = r.right + pad, y1 = r.bottom + pad;
    hi.style.cssText = 'left:' + x0 + 'px;top:' + y0 + 'px;width:' + (x1 - x0) + 'px;height:' + (y1 - y0) + 'px';
    // The dim layer with a hole cut out over the target.
    dim.style.clipPath = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' +
      x0 + 'px ' + y0 + 'px, ' + x1 + 'px ' + y0 + 'px, ' + x1 + 'px ' + y1 + 'px, ' + x0 + 'px ' + y1 + 'px, ' + x0 + 'px ' + y0 + 'px)';
    var x, y;
    if (r.width > vw * 0.45) { x = r.left + 16; y = r.top + 16; }         // big target (the picture): card inside its corner
    else if (r.right + 18 + cw < vw) { x = r.right + 18; y = r.top; }
    else if (r.left - 18 - cw > 0) { x = r.left - 18 - cw; y = r.top; }
    else { x = r.left; y = r.bottom + 14; }
    card.style.left = Math.max(12, Math.min(vw - cw - 12, x)) + 'px';
    card.style.top = Math.max(12, Math.min(vh - ch - 12, y)) + 'px';
  }

  function start() {
    if (!hi) build();
    usedSample = false;
    var before = {};
    A().S.libOrder.forEach(function (id) { before[id] = 1; });
    saved = { layout: A().layoutState(), libBefore: before };
    TT.tourOpen = true;
    document.body.classList.add('touring');
    hi.hidden = card.hidden = dim.hidden = false;
    go(0);
  }

  function end() {
    TT.tourOpen = false;
    document.body.classList.remove('touring');
    if (hi) hi.hidden = card.hidden = dim.hidden = true;
    // Put the user's bin back; drop the sample tools (shapes from their own photo stay).
    if (saved) {
      A().restore(saved.layout, usedSample ? tourIds() : []);
      saved = null;
    }
    TT.tourSample = false;
    try { localStorage.setItem('tooltrace.tourDone', '1'); } catch (e) { /* ignore */ }
  }

  document.addEventListener('keydown', function (e) {
    if (!TT.tourOpen) return;
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (!STEPS[idx].noNext) go(idx + 1); }
    else if (e.key === 'ArrowLeft') go(idx - 1);
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  TT.tour = { start: start, end: end, steps: STEPS };
  $('tourBtn').onclick = start;
  var seen = false;
  try { seen = !!localStorage.getItem('tooltrace.tourDone'); } catch (e) { seen = true; }
  if (!seen) setTimeout(start, 300);
})();
