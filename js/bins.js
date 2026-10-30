/* ToolTrace standard Gridfinity bins (no tool pockets): feet, floor, walls, compartment
   dividers, label tab, finger scoop and stacking lip. Mesh coordinates are mm, z up, y up, with
   the bin's front-left corner at 0, 0 (front = y 0, back = y max). Every part is its own closed
   shell; they overlap and the slicer merges them. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  var G = TT.GF, WALL = 1.2, FLOOR = 1.2, DIV = 1.2, LABEL = 12, SCOOP = 15, OVER = 0.1;

  // Mesh → Float32Array with outward faces.
  function done(m) {
    var v = new Float32Array(m.v);
    if (TT.volume(v) < 0) for (var t = 0; t < v.length; t += 9) for (var k = 0; k < 3; k++) {
      var tmp = v[t + 3 + k]; v[t + 3 + k] = v[t + 6 + k]; v[t + 6 + k] = tmp;
    }
    return v;
  }

  // Axis-aligned box.
  function box(x0, y0, x1, y1, z0, z1) {
    var m = new TT.Mesh(), r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    TT.loft(m, [{ z: z0, pts: r }, { z: z1, pts: r }]);
    return done(m);
  }

  // Closed bar: a [y, z] profile (simple polygon) extruded along x from x0 to x1.
  function bar(prof, x0, x1) {
    if (TT.loopArea(prof) < 0) prof = prof.slice().reverse();
    var m = new TT.Mesh(), flat = [];
    prof.forEach(function (p) { flat.push(p[0], p[1]); });
    var t = TT.earcut(flat);
    for (var i = 0; i < t.length; i += 3) {
      var a = prof[t[i]], b = prof[t[i + 1]], c = prof[t[i + 2]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) < 0) { var tmp = b; b = c; c = tmp; }
      m.tri([x1, a[0], a[1]], [x1, b[0], b[1]], [x1, c[0], c[1]]);
      m.tri([x0, a[0], a[1]], [x0, c[0], c[1]], [x0, b[0], b[1]]);
    }
    prof.forEach(function (p, k) {
      var q = prof[(k + 1) % prof.length];
      m.quad([x0, p[0], p[1]], [x0, q[0], q[1]], [x1, q[0], q[1]], [x1, p[0], p[1]]);
    });
    return done(m);
  }

  // Inner faces of n equal compartments across [lo, hi] split by DIV-thick walls: [[a, b], ...].
  function cells(lo, hi, n) {
    var p = (hi - lo + DIV) / n, out = [];
    for (var i = 0; i < n; i++) out.push([lo + i * p, lo + i * p + p - DIV]);
    return out;
  }

  // opt = {kx, ky (grid units), units (7 mm), cx, cy (compartments), label, scoop, lip}.
  // Returns {shells: [Float32Array], missingArea} like TT.pieceMesh.
  TT.stdBinMesh = function (opt) {
    var kx = Math.max(1, opt.kx | 0), ky = Math.max(1, opt.ky | 0);
    var nx = Math.max(1, opt.cx | 0), ny = Math.max(1, opt.cy | 0);
    var W = TT.binSize(kx), H = TT.binSize(ky), Z = Math.max(1, opt.units | 0) * G.unitH;
    var fz = G.baseH + FLOOR, h = Z - fz, shells = [], missing = 0, m;

    // Feet, one per grid cell (same as tool bins).
    for (var gy = 0; gy < ky; gy++) for (var gx = 0; gx < kx; gx++) {
      var cx = gx * G.pitch + 20.75, cy = gy * G.pitch + 20.75;
      m = new TT.Mesh();
      TT.loft(m, G.foot.map(function (f) {
        return { z: f[0], pts: TT.roundRect(cx, cy, 41.5 - 2 * f[1], 41.5 - 2 * f[1], G.radius - f[1], 8) };
      }));
      shells.push(new Float32Array(m.v));
    }

    // Base slab up to the floor, then the outer wall (outline with an inset hole).
    var outline = TT.roundRect(W / 2, H / 2, W, H, G.radius, 8);
    m = new TT.Mesh();
    TT.loft(m, [{ z: G.baseH, pts: outline }, { z: fz, pts: outline }]);
    shells.push(new Float32Array(m.v));
    m = new TT.Mesh();
    var hole = TT.roundRect(W / 2, H / 2, W - 2 * WALL, H - 2 * WALL, G.radius - WALL, 8).reverse();
    missing += TT.prism(m, [outline, hole], fz - 0.2, Z);
    shells.push(new Float32Array(m.v));

    // Compartment dividers, overlapping the floor and walls by 0.2.
    var xs = cells(WALL, W - WALL, nx), ys = cells(WALL, H - WALL, ny), i;
    for (i = 1; i < nx; i++) shells.push(box(xs[i - 1][1], WALL - 0.2, xs[i][0], H - WALL + 0.2, fz - 0.2, Z));
    for (i = 1; i < ny; i++) shells.push(box(WALL - 0.2, ys[i - 1][1], W - WALL + 0.2, ys[i][0], fz - 0.2, Z));

    // Per compartment row: label tab on the back face (flat top, 45° underside) and finger scoop
    // on the front face (quarter circle down to the floor). Both run the full inner width.
    ys.forEach(function (r) {
      var depth = r[1] - r[0];
      if (opt.label) {
        var d = Math.min(LABEL, depth * 0.4, h - 0.5), yb = r[1];
        if (d > 0.3) shells.push(bar([[yb + OVER, Z], [yb - d, Z], [yb + OVER, Z - d - OVER]], WALL, W - WALL));
      }
      if (opt.scoop) {
        var s = Math.min(SCOOP, h / 2, depth * 0.5), yf = r[0], prof = [[yf - OVER, fz - OVER], [yf + s, fz - OVER]];
        if (s > 0.5) {
          for (var a = 0; a <= 12; a++) {
            var t = (270 - 90 * a / 12) * Math.PI / 180;
            prof.push([yf + s + s * Math.cos(t), fz + s + s * Math.sin(t)]);
          }
          prof.push([yf - OVER, fz + s]);
          shells.push(bar(prof, WALL, W - WALL));
        }
      }
    });

    // Stacking lip on top of the outer wall; its support stops just inside the floor.
    if (opt.lip) shells.push(TT.sweep(W / 2, H / 2, W / 2, H / 2, G.radius, TT.lipProfile(Z, fz - 0.2)));

    return { shells: shells, missingArea: missing };
  };
})();
