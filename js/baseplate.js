/* ToolTrace ultralight Gridfinity baseplate: split an area into printable pieces and build each
   piece's mesh. The cell profile is measured from the "Lightest Gridfinity Base" 3MF (Sparky,
   MakerWorld): walls only, no floor, no bottom lip, top sliver cut off, holes where cells meet.
   Mesh coordinates are mm, z up, y up; a piece's origin is its bottom-left corner. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  var B = TT.BP = {
    pitch: 42, radius: 4, height: 4.25, wall: 0.82, seg: 8,
    // Cell profile [d, z]: d = inset from the cell's rounded square (radius 4), z from the bed.
    // Inner face: 2.15 straight up to 2.5, then 45° out to the 0.4 wide top. A 0.82 wall follows
    // it with an open hollow underneath that closes at the cell edge (z 3.49). The top reaches
    // 0.01 past the edge so neighbouring cells overlap and the slicer merges them.
    cell: [[2.15, 0], [2.15, 2.5], [0.4, 4.25], [-0.01, 4.25], [-0.01, 3.5], [1.33, 2.16], [1.33, 0]]
  };

  // ---------- Planning ----------

  // Split n cells along one axis into pieces no wider than maxMm (the outer pieces also carry
  // padStart / padEnd mm), each at least minRows cells. Fewest pieces, sizes as even as possible.
  function splitAxis(n, padStart, padEnd, maxMm, minRows) {
    for (var min = Math.min(minRows, n); min >= 1; min--) {
      for (var k = 1; k <= n; k++) {
        if (k * min > n) break;
        var cap = [], room = 0, ok = true;
        for (var i = 0; i < k; i++) {
          var pad = (i === 0 ? padStart : 0) + (i === k - 1 ? padEnd : 0);
          cap.push(Math.floor((maxMm - pad + 1e-6) / B.pitch));
          if (cap[i] < min) ok = false;
          room += cap[i];
        }
        if (!ok || room < n) continue;
        // Extra cells go to the smallest piece, middle ones first, so the ends match when they can.
        var s = cap.map(function () { return min; }), left = n - k * min, mid = (k - 1) / 2;
        while (left > 0) {
          var best = -1;
          for (i = 0; i < k; i++) {
            if (s[i] >= cap[i]) continue;
            if (best < 0 || s[i] < s[best] || s[i] === s[best] && Math.abs(i - mid) < Math.abs(best - mid)) best = i;
          }
          s[best]++; left--;
        }
        return { sizes: s, min: min };
      }
    }
    return null;
  }

  // Rotate a piece 90° counter-clockwise: pads are [left, bottom, right, top].
  function rot90(p) { return { kx: p.ky, ky: p.kx, pad: [p.pad[3], p.pad[0], p.pad[1], p.pad[2]] }; }
  function pieceKey(p) { return p.kx + 'x' + p.ky + ':' + p.pad.map(function (v) { return v.toFixed(2); }).join(','); }

  // o = {w, d (area mm), clearance (total, per axis), maxPrint (mm), minRows, fill (pad edges),
  // corner (optional, see below)}. Returns {nx, ny, grid: [x0, y0], side, pad (both [l, f, r, b]),
  // pieces, types, warnings, error}.
  TT.bpPlan = function (o) {
    var P = B.pitch, nx = Math.floor((o.w - o.clearance + 1e-6) / P), ny = Math.floor((o.d - o.clearance + 1e-6) / P);
    var out = { w: o.w, d: o.d, nx: nx, ny: ny, pieces: [], types: [], warnings: [] };
    if (nx < 1 || ny < 1) { out.error = 'The area is smaller than one 42 mm cell.'; return out; }
    // Leftover space per side [left, front, right, back], clearance included: split evenly, or
    // all on the sides of o.corner ('lf', 'rb', ...: left/right + front/back) so the opposite
    // edges are plain cells. Padding = that space minus half the clearance.
    var lx = o.w - nx * P, ly = o.d - ny * P, c2 = o.clearance / 2, k = o.corner;
    var side = k ? [k[0] === 'l' ? lx - c2 : c2, k[1] === 'f' ? ly - c2 : c2, k[0] === 'r' ? lx - c2 : c2, k[1] === 'b' ? ly - c2 : c2]
      : [lx / 2, ly / 2, lx / 2, ly / 2];
    var pad = side.map(function (m) { return o.fill && m - c2 >= 0.05 ? m - c2 : 0; });
    out.grid = [side[0], side[1]]; out.side = side; out.pad = pad;
    var cols = splitAxis(nx, pad[0], pad[2], o.maxPrint, o.minRows), rows = splitAxis(ny, pad[1], pad[3], o.maxPrint, o.minRows);
    if (!cols || !rows) { out.error = 'A piece of one cell' + (pad.some(Boolean) ? ' plus padding' : '') + ' is bigger than the max print size.'; return out; }
    var shortest = Math.min(cols.min, rows.min);
    if (shortest < o.minRows) {
      out.warnings.push(Math.min(nx, ny) < o.minRows ? 'The area is only ' + Math.min(nx, ny) + ' cell' + (Math.min(nx, ny) > 1 ? 's' : '') + ' across, so some pieces are narrower than ' + o.minRows + ' rows.'
        : 'Pieces of ' + o.minRows + '+ rows don’t fit the print size here; some are ' + shortest + ' row' + (shortest > 1 ? 's' : '') + ' wide.');
    }
    var types = {}, iy = 0;
    rows.sizes.forEach(function (ky, r) {
      var ix = 0;
      cols.sizes.forEach(function (kx, c) {
        var pp = [c === 0 ? pad[0] : 0, r === 0 ? pad[1] : 0, c === cols.sizes.length - 1 ? pad[2] : 0, r === rows.sizes.length - 1 ? pad[3] : 0];
        var pc = { ix: ix, iy: iy, kx: kx, ky: ky, col: c, row: r, pad: pp,
          x: side[0] + ix * P - pp[0], y: side[1] + iy * P - pp[1], w: kx * P + pp[0] + pp[2], h: ky * P + pp[1] + pp[3] };
        // Same print = same piece turned on the bed (mirror images are different prints).
        var q = pc, key = pieceKey(q);
        for (var t = 0; t < 3; t++) { q = rot90(q); if (pieceKey(q) < key) key = pieceKey(q); }
        if (!types[key]) { types[key] = { key: key, kx: kx, ky: ky, pad: pp, w: pc.w, h: pc.h, count: 0 }; out.types.push(types[key]); }
        types[key].count++;
        pc.type = types[key];
        out.pieces.push(pc);
        ix += kx;
      });
      iy += ky;
    });
    out.types.sort(function (a, b) { return b.kx * b.ky - a.kx * a.ky || b.count - a.count; });
    out.types.forEach(function (t, i) { t.label = String.fromCharCode(65 + i % 26) + (i >= 26 ? Math.floor(i / 26) : ''); });
    return out;
  };

  // ---------- Mesh ----------

  function Mesh() { this.v = []; }
  Mesh.prototype.tri = function (a, b, c) { this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  Mesh.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  Mesh.prototype.done = function () {
    var v = new Float32Array(this.v);
    if (TT.volume(v) < 0) for (var t = 0; t < v.length; t += 9) for (var k = 0; k < 3; k++) {
      var tmp = v[t + 3 + k]; v[t + 3 + k] = v[t + 6 + k]; v[t + 6 + k] = tmp;
    }
    return v;
  };

  // Closed ring solid: profile [d, z] swept around a rounded rectangle (centre cx, cy, half
  // sizes hw, hh, corner radius r); d is the inset from the rectangle's edge.
  function sweep(cx, cy, hw, hh, r, prof) {
    var m = new Mesh(), rings = [], corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(function (k, ci) {
      var ox = cx + k[0] * (hw - r), oy = cy + k[1] * (hh - r);
      for (var i = 0; i <= B.seg; i++) {
        var a = (ci + i / B.seg) * Math.PI / 2, ux = Math.cos(a), uy = Math.sin(a);
        rings.push(prof.map(function (p) { return [ox + (r - p[0]) * ux, oy + (r - p[0]) * uy, p[1]]; }));
      }
    });
    for (var i = 0; i < rings.length; i++) {
      var A = rings[i], N = rings[(i + 1) % rings.length];
      for (var j = 0; j < prof.length; j++) {
        var k = (j + 1) % prof.length;
        m.quad(A[j], A[k], N[k], N[j]);
      }
    }
    return m.done();
  }

  function box(x0, y0, x1, y1, z0, z1) {
    var m = new Mesh(), c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (var i = 0; i < 4; i++) {
      var p = c[i], q = c[(i + 1) % 4];
      m.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]);
    }
    m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    m.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    return m.done();
  }

  // One piece {kx, ky, pad: [l, b, r, t]}: a swept wall per cell, the outer wall, and on padded
  // sides a wall along the grid edge tied to the outer wall by ribs on the grid lines.
  TT.bpMesh = function (pc) {
    var P = B.pitch, R = B.radius, H = B.height, w = B.wall, pad = pc.pad;
    var W = pc.kx * P + pad[0] + pad[2], D = pc.ky * P + pad[1] + pad[3], gx0 = pad[0], gy0 = pad[1];
    var gx1 = gx0 + pc.kx * P, gy1 = gy0 + pc.ky * P, shells = [];
    for (var j = 0; j < pc.ky; j++) for (var i = 0; i < pc.kx; i++)
      shells.push(sweep(gx0 + (i + 0.5) * P, gy0 + (j + 0.5) * P, P / 2, P / 2, R, B.cell));
    shells.push(sweep(W / 2, D / 2, W / 2, D / 2, R, [[0, 0], [w, 0], [w, H], [0, H]]));
    // Where a wall along one edge may start so it stays inside the piece's rounded corner, when
    // it sits `off` mm in from the perpendicular edge.
    function inset(off) { return off >= R ? 0 : R - Math.sqrt(R * R - (R - off) * (R - off)) + 0.01; }
    // Side s (0 left, 1 bottom, 2 right, 3 top) in edge-local terms: along = x for bottom/top.
    [0, 1, 2, 3].forEach(function (s) {
      if (pad[s] <= 0) return;
      var horiz = s === 1 || s === 3, len = horiz ? W : D, lo = horiz ? gx0 : gy0, hi = horiz ? gx1 : gy1;
      var e0 = s === 0 || s === 1 ? pad[s] : (horiz ? D : W) - pad[s];  // grid edge across the side
      var a0 = Math.max(lo, inset(pad[s])), a1 = Math.min(hi, len - inset(pad[s]));
      var strip = s === 0 || s === 1 ? [e0, e0 + w] : [e0 - w, e0];
      var outer = s === 0 || s === 1 ? [0, e0 + w] : [e0 - w, horiz ? D : W];
      function add(a, b, c, d) { shells.push(horiz ? box(a, c, b, d, 0, H) : box(c, a, d, b, 0, H)); }
      add(a0, a1, strip[0], strip[1]);
      for (var k = 0; k <= (horiz ? pc.kx : pc.ky); k++) {
        var at = lo + k * P;
        if (at - w / 2 < R || at + w / 2 > len - R) continue;
        add(at - w / 2, at + w / 2, outer[0], outer[1]);
      }
    });
    return { shells: shells, w: W, h: D };
  };
})();
