/* ToolTrace grid detection for cutting mats. Finds grid-line crossings, then numbers them by
   growing a lattice outward from the centre (tolerates clutter, tools covering the grid, and
   mild perspective). Assumes the grid is roughly lined up with the photo edges (within ~15°). */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  // Points in square buckets for radius searches.
  function bucketise(list, cell) {
    var map = new Map();
    list.forEach(function (p, idx) {
      var key = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(idx);
    });
    return {
      near: function (x, y, rad) {
        var out = [], cx = Math.floor(x / cell), cy = Math.floor(y / cell), span = Math.ceil(rad / cell);
        for (var yy = cy - span; yy <= cy + span; yy++) for (var xx = cx - span; xx <= cx + span; xx++) {
          var l = map.get(xx + ',' + yy);
          if (l) l.forEach(function (id) { if (Math.hypot(list[id].x - x, list[id].y - y) <= rad) out.push(id); });
        }
        return out;
      }
    };
  }

  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }

  function gray(src) {
    var s = Math.max(1, Math.round(Math.max(src.width, src.height) / 2000));
    var w = Math.floor(src.width / s), h = Math.floor(src.height / s), d = src.data, g = new Float32Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var sum = 0;
      for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) {
        var o = ((j * s + y) * src.width + i * s + x) * 4;
        sum += d[o] + d[o + 1] + d[o + 2];
      }
      g[j * w + i] = sum / (3 * s * s);
    }
    return { g: g, w: w, h: h, s: s };
  }

  // Line response along one axis, box-smoothed along the line direction.
  function lineResponse(G, horizontal, pol, d, r) {
    var w = G.w, h = G.h, g = G.g, R = new Float32Array(w * h), S = new Float32Array(w * h), i, j;
    for (j = d; j < h - d; j++) for (i = d; i < w - d; i++) {
      var k = j * w + i;
      R[k] = pol * (g[k] - 0.5 * (horizontal ? g[k - d * w] + g[k + d * w] : g[k - d] + g[k + d]));
    }
    if (horizontal) {
      for (j = 0; j < h; j++) {
        var acc = 0;
        for (i = 0; i < w; i++) {
          acc += R[j * w + i];
          if (i > 2 * r) acc -= R[j * w + i - 2 * r - 1];
          if (i >= r) S[j * w + i - r] = acc / (2 * r + 1);
        }
      }
    } else {
      for (i = 0; i < w; i++) {
        var acc2 = 0;
        for (j = 0; j < h; j++) {
          acc2 += R[j * w + i];
          if (j > 2 * r) acc2 -= R[(j - 2 * r - 1) * w + i];
          if (j >= r) S[(j - r) * w + i] = acc2 / (2 * r + 1);
        }
      }
    }
    return S;
  }

  // Period (px) of a 1-D profile: first clear autocorrelation peak after the central lobe.
  function profilePeriod(prof) {
    var n = prof.length, i, hp = new Float64Array(n), r = 20;
    for (i = 0; i < n; i++) { // high-pass: remove the local mean so big shapes don't count
      var s = 0, c = 0;
      for (var k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) { s += prof[k]; c++; }
      hp[i] = prof[i] - s / c;
    }
    var maxLag = Math.min(120, n >> 1), ac = new Float64Array(maxLag + 2);
    for (var lag = 0; lag <= maxLag + 1; lag++) {
      var t = 0;
      for (i = 0; i + lag < n; i++) t += hp[i] * hp[i + lag];
      ac[lag] = t / (n - lag);
    }
    var start = 2;
    while (start < maxLag && ac[start] > 0) start++;
    for (lag = start; lag <= maxLag; lag++) {
      if (ac[lag] > 0.25 * ac[0] && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
        var a = ac[lag - 1], b = ac[lag], c2 = ac[lag + 1], den = a - 2 * b + c2;
        return lag + (den ? 0.5 * (a - c2) / den : 0);
      }
    }
    return 0;
  }

  // Grid spacing (px): median of the line period measured in many thin strips (thin so a slightly
  // rotated grid doesn't smear), for both line directions, so clutter in a few strips is outvoted.
  function gridSpacing(Rh, Rv, w, h) {
    var found = [], L = Math.min(400, Math.floor(Math.min(w, h) / 2)), T = 40, x0, y0, i, j;
    for (y0 = 0; y0 + T <= h; y0 += Math.floor(h / 12)) for (x0 = 0; x0 + L <= w; x0 += Math.floor(w / 5)) {
      var colP = new Float64Array(L);
      for (j = 0; j < T; j++) for (i = 0; i < L; i++) colP[i] += Math.max(0, Rv[(y0 + j) * w + x0 + i]);
      var a = profilePeriod(colP);
      if (a > 4) found.push(a);
    }
    for (x0 = 0; x0 + T <= w; x0 += Math.floor(w / 12)) for (y0 = 0; y0 + L <= h; y0 += Math.floor(h / 5)) {
      var rowP = new Float64Array(L);
      for (i = 0; i < T; i++) for (j = 0; j < L; j++) rowP[j] += Math.max(0, Rh[(y0 + j) * w + x0 + i]);
      var b = profilePeriod(rowP);
      if (b > 4) found.push(b);
    }
    return found.length >= 6 ? median(found) : 0;
  }

  // Grid crossings: local maxima of min(horizontal, vertical line response), with the response
  // smoothed along each line over ~0.8 of the grid spacing.
  function crossings(G, pol, spacing) {
    var w = G.w, h = G.h, n = w * h, i, j, k;
    var d = Math.max(1, Math.min(3, Math.floor(spacing / 4))), r = Math.max(2, Math.round(0.4 * spacing));
    var Rh = lineResponse(G, true, pol, d, r), Rv = lineResponse(G, false, pol, d, r), C = new Float32Array(n);
    for (k = 0; k < n; k++) C[k] = Math.min(Rh[k], Rv[k]);
    var sample = [];
    for (k = 0; k < n; k += 13) sample.push(Math.abs(Rh[k]));
    var thr = 3 * 1.4826 * median(sample), m = Math.max(2, Math.round(0.3 * spacing)), peaks = [];
    for (j = m; j < h - m; j++) for (i = m; i < w - m; i++) {
      k = j * w + i;
      var v = C[k];
      if (v <= thr) continue;
      var isMax = true;
      for (var b = -m; b <= m && isMax; b++) for (var a = -m; a <= m; a++) {
        var q = C[k + b * w + a];
        if (q > v || (q === v && (b < 0 || (b === 0 && a < 0)))) { isMax = false; break; }
      }
      if (!isMax) continue;
      // Sub-pixel refinement (parabola through neighbours).
      var dx = (C[k + 1] - C[k - 1]) / (2 * (2 * v - C[k + 1] - C[k - 1]) || 1);
      var dy = (C[k + w] - C[k - w]) / (2 * (2 * v - C[k + w] - C[k - w]) || 1);
      peaks.push({ x: i + Math.max(-0.5, Math.min(0.5, dx)), y: j + Math.max(-0.5, Math.min(0.5, dy)), v: v });
    }
    return peaks.sort(function (A, B) { return B.v - A.v; });
  }

  function detect(G, pol) {
    var w = G.w, h = G.h;
    var est = gridSpacing(lineResponse(G, true, pol, 2, 3), lineResponse(G, false, pol, 2, 3), w, h);
    if (!(est > 4)) return null;
    // The period estimate can land on a multiple of the true spacing, so try fractions of it and
    // keep the lattice that scores best: count x median crossing strength (noise crossings are weak).
    var best = null;
    [1, 1 / 2, 1 / 3].forEach(function (f) {
      if (est * f < 5) return;
      var peaks = crossings(G, pol, est * f);
      if (peaks.length < 16) return;
      var r = grow(peaks, est * f);
      if (!r) return;
      // A real grid fits one perspective mapping closely (in cell units); noise lattices don't.
      var fit = TT.gridHomography({ points: r.pts.map(function (q) { return { img: [q.x, q.y], i: q.i, j: q.j }; }) }, 1);
      if (fit.rms > 0.15) return;
      r.score = fit.used * median(r.pts.map(function (q) { return q.v; }));
      if (!best || r.score > best.score) best = r;
    });
    if (!best) return null;
    var pts = best.pts, spacing = best.spacing;
    var mi = Infinity, mj = Infinity, xi = -Infinity, xj = -Infinity;
    pts.forEach(function (q) { mi = Math.min(mi, q.i); mj = Math.min(mj, q.j); xi = Math.max(xi, q.i); xj = Math.max(xj, q.j); });
    return {
      points: pts.map(function (q) { return { img: [(q.x + 0.5) * G.s, (q.y + 0.5) * G.s], i: q.i - mi, j: q.j - mj }; }),
      ni: xi - mi + 1, nj: xj - mj + 1, spacingPx: spacing * G.s, score: best.score
    };
  }

  // Number the crossings by growing a lattice of the given spacing from a seed near the centre.
  function grow(peaks, spacing) {
    var w = 0, h = 0, k;
    peaks.forEach(function (p) { w = Math.max(w, p.x); h = Math.max(h, p.y); });
    var bk;
    // Keep the strongest peak in each neighbourhood.
    var kept = [], cellSz = 0.45 * spacing, taken = new Map();
    peaks.forEach(function (p) {
      var cx = Math.floor(p.x / cellSz), cy = Math.floor(p.y / cellSz);
      for (var yy = cy - 1; yy <= cy + 1; yy++) for (var xx = cx - 1; xx <= cx + 1; xx++) {
        var q = taken.get(xx + ',' + yy);
        if (q && Math.abs(q.x - p.x) <= cellSz && Math.abs(q.y - p.y) <= cellSz) return;
      }
      taken.set(cx + ',' + cy, p);
      kept.push(p);
    });
    peaks = kept;
    bk = bucketise(peaks, spacing);

    function step(p, dir) { // nearest neighbour roughly in direction dir (0 = +x, 1 = +y)
      var best = null, bd = Infinity;
      bk.near(p.x, p.y, 1.5 * spacing).forEach(function (id) {
        var q = peaks[id], ddx = q.x - p.x, ddy = q.y - p.y, d = Math.hypot(ddx, ddy);
        if (d < 0.6 * spacing) return;
        var ok = dir === 0 ? ddx > 0 && Math.abs(ddy) < 0.4 * ddx : ddy > 0 && Math.abs(ddx) < 0.4 * ddy;
        if (ok && d < bd) { bd = d; best = q; }
      });
      return best;
    }
    // Grow the lattice from a seed: predict each neighbour from the local lattice vectors and snap
    // to a crossing.
    function growFrom(seed, u, vv) {
      var nodes = new Map(), byKey = new Map(), queue = [], dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var first = { p: seed, i: 0, j: 0, u: u, vv: vv };
      nodes.set(seed, first); byKey.set('0,0', first); queue.push(first);
      for (var qi = 0; qi < queue.length; qi++) {
        var n = queue[qi];
        for (var di = 0; di < 4; di++) {
          var dd = dirs[di], key = (n.i + dd[0]) + ',' + (n.j + dd[1]);
          if (byKey.has(key)) continue;
          var px = n.p.x + dd[0] * n.u[0] + dd[1] * n.vv[0], py = n.p.y + dd[0] * n.u[1] + dd[1] * n.vv[1];
          var best = null, bd = 0.3 * spacing;
          bk.near(px, py, bd).forEach(function (id) {
            var q = peaks[id], d = Math.hypot(q.x - px, q.y - py);
            if (!nodes.has(q) && d <= bd) { bd = d; best = q; }
          });
          if (!best) continue;
          // Update the lattice vector along the step taken; carry the other one over.
          var sgn = dd[0] + dd[1], stepV = [(best.x - n.p.x) * sgn, (best.y - n.p.y) * sgn];
          var node = { p: best, i: n.i + dd[0], j: n.j + dd[1], u: dd[0] ? stepV : n.u, vv: dd[1] ? stepV : n.vv };
          nodes.set(best, node); byKey.set(key, node); queue.push(node);
        }
      }
      return queue.map(function (nd) { return { x: nd.p.x, y: nd.p.y, v: nd.p.v, i: nd.i, j: nd.j }; });
    }
    // Try several strong seeds (some may sit on clutter) and keep the largest lattice.
    var best = [], tried = 0;
    for (k = 0; k < peaks.length && tried < 8; k++) {
      var p0 = peaks[k], ru = step(p0, 0), rv = step(p0, 1);
      if (!ru || !rv) continue;
      if (best.some(function (c) { return c.x === p0.x && c.y === p0.y; })) continue;
      tried++;
      var got = growFrom(p0, [ru.x - p0.x, ru.y - p0.y], [rv.x - p0.x, rv.y - p0.y]);
      if (got.length > best.length) best = got;
    }
    return best.length < 16 ? null : { pts: best, spacing: spacing };
  }

  // Returns {points: [{img: [x, y], i, j}], ni, nj, spacingPx} or null.
  TT.detectGrid = function (src, G) {
    G = G || gray(src);
    var best = null;
    [1, -1].forEach(function (pol) {
      var r = detect(G, pol);
      if (r && (!best || r.score > best.score)) best = r;
    });
    return best;
  };

  // ---------- Semi-automatic: the user puts 4 handles on grid crossings ----------

  // Given 4 handles (image px, any order, roughly on crossings) and the number of squares across
  // (nx) and down (ny), label every crossing inside and fit. Returns a grid like TT.detectGrid.
  // `G` is TT.gridGray(src), cached per photo.
  TT.gridGray = gray;
  TT.refineGrid = function (G, corners, nx, ny) {
    var s = G.s, c = TT.orderCorners(corners).map(function (p) { return [p[0] / s - 0.5, p[1] / s - 0.5]; });
    var cell = (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1])) / (2 * nx);
    cell = (cell + (Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) + Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1])) / (2 * ny)) / 2;
    var best = null;
    [1, -1].forEach(function (pol) {
      var peaks = crossings(G, pol, Math.max(6, cell));
      var H = TT.homography([[0, 0], [nx, 0], [nx, ny], [0, ny]], c), pts = [];
      [0.35, 0.25, 0.2, 0.2].forEach(function (tol) {
        var inv = TT.invertH(H), cells = new Map();
        peaks.forEach(function (q) {
          var g = TT.applyH(inv, q.x, q.y), i = Math.round(g[0]), j = Math.round(g[1]);
          if (i < 0 || j < 0 || i > nx || j > ny) return;
          var pr = TT.applyH(H, i, j), d = Math.hypot(pr[0] - q.x, pr[1] - q.y);
          if (d > tol * cell) return;
          var key = i + ',' + j, have = cells.get(key);
          if (!have || d < have.d) cells.set(key, { x: q.x, y: q.y, i: i, j: j, d: d });
        });
        pts = [];
        cells.forEach(function (p) { pts.push(p); });
        if (pts.length >= 8) H = TT.homography(pts.map(function (p) { return [p.i, p.j]; }), pts.map(function (p) { return [p.x, p.y]; }));
      });
      if (pts.length >= 8 && (!best || pts.length > best.length)) best = pts;
    });
    if (!best) return null;
    return {
      points: best.map(function (p) { return { img: [(p.x + 0.5) * s, (p.y + 0.5) * s], i: p.i, j: p.j }; }),
      ni: nx + 1, nj: ny + 1, spacingPx: cell * s
    };
  };

  // Corners (image px) and square counts for a detected grid, to seed the handles.
  TT.gridCorners = function (grid) {
    var fit = TT.gridHomography(grid, 1), mi = Infinity, mj = Infinity, xi = -Infinity, xj = -Infinity;
    grid.points.forEach(function (p) { mi = Math.min(mi, p.i); mj = Math.min(mj, p.j); xi = Math.max(xi, p.i); xj = Math.max(xj, p.j); });
    return {
      corners: [[mi, mj], [xi, mj], [xi, xj], [mi, xj]].map(function (q) { return TT.applyH(fit.H, q[0], q[1]); }),
      nx: xi - mi, ny: xj - mj
    };
  };

  // Fit grid -> image homography for a grid spacing in mm, dropping outliers. Reports RMS error (mm).
  TT.gridHomography = function (grid, spacingMm) {
    var pts = grid.points, H, inv, res;
    for (var pass = 0; pass < 3; pass++) {
      H = TT.homography(pts.map(function (p) { return [p.i * spacingMm, p.j * spacingMm]; }), pts.map(function (p) { return p.img; }));
      inv = TT.invertH(H);
      res = pts.map(function (p) {
        var q = TT.applyH(inv, p.img[0], p.img[1]);
        return Math.hypot(q[0] - p.i * spacingMm, q[1] - p.j * spacingMm);
      });
      var lim = Math.max(3 * median(res), 0.1 * spacingMm);
      var next = pts.filter(function (p, k) { return res[k] <= lim; });
      if (next.length === pts.length || next.length < 16) break;
      pts = next;
    }
    var e2 = 0;
    res.forEach(function (r) { e2 += r * r; });
    return { H: H, rms: Math.sqrt(e2 / res.length), used: pts.length };
  };
})();
