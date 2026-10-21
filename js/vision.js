/* ToolTrace vision: perspective correction, tool segmentation, distance transforms, contours
   and outline extraction. Image coordinates are pixels with y down. Paper coordinates are mm
   with y down. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  // ---------- Linear algebra / perspective ----------

  function solve(A, b) {
    var n = b.length, i, j, k;
    A = A.map(function (row, r) { return row.concat([b[r]]); });
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var t = A[i]; A[i] = A[piv]; A[piv] = t;
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k <= n; k++) A[j][k] -= f * A[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = A[i][n];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  function mul3(a, b) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    return o;
  }

  // Least-squares homography (row-major 9 numbers) mapping `from` points onto `to` points
  // (4 or more), with Hartley normalisation.
  TT.homography = function (from, to) {
    function norm(pts) {
      var mx = 0, my = 0, d = 0;
      pts.forEach(function (p) { mx += p[0] / pts.length; my += p[1] / pts.length; });
      pts.forEach(function (p) { d += Math.hypot(p[0] - mx, p[1] - my) / pts.length; });
      var s = Math.SQRT2 / (d || 1);
      return { s: s, mx: mx, my: my, p: pts.map(function (p) { return [(p[0] - mx) * s, (p[1] - my) * s]; }) };
    }
    var F = norm(from), T = norm(to), AtA = [], Atb = [], i, j;
    for (i = 0; i < 8; i++) { AtA.push(new Array(8).fill(0)); Atb.push(0); }
    function add(row, b) {
      for (var r = 0; r < 8; r++) {
        if (!row[r]) continue;
        for (var c = 0; c < 8; c++) AtA[r][c] += row[r] * row[c];
        Atb[r] += row[r] * b;
      }
    }
    for (i = 0; i < from.length; i++) {
      var x = F.p[i][0], y = F.p[i][1], u = T.p[i][0], v = T.p[i][1];
      add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
      add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
    }
    var h = solve(AtA, Atb);
    h.push(1);
    var Tf = [F.s, 0, -F.s * F.mx, 0, F.s, -F.s * F.my, 0, 0, 1];
    var TtInv = [1 / T.s, 0, T.mx, 0, 1 / T.s, T.my, 0, 0, 1];
    var H = mul3(TtInv, mul3(h, Tf));
    for (j = 0; j < 9; j++) H[j] /= H[8];
    return H;
  };

  TT.applyH = function (h, x, y) {
    var w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };

  TT.invertH = function (m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], k = m[8];
    var A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    var r = [A, -(b * k - c * h), b * f - c * e, B, a * k - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
    return r.map(function (v) { return v / det; });
  };

  // Sort 4 corners into top-left, top-right, bottom-right, bottom-left (image y down).
  TT.orderCorners = function (pts) {
    var cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0] / 4; cy += p[1] / 4; });
    var s = pts.slice().sort(function (a, b) {
      return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx);
    });
    var k = 0;
    for (var i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
    return s.slice(k).concat(s.slice(0, k));
  };

  // [width, height] in mm for a reference rectangle, with the longer side following whichever
  // pair of photo edges is longer.
  TT.fitRef = function (c, a, b) {
    var d = function (p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); };
    var across = d(c[0], c[1]) + d(c[3], c[2]), down = d(c[0], c[3]) + d(c[1], c[2]);
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return across >= down ? [hi, lo] : [lo, hi];
  };

  // Resample the photo onto a flat mm grid. H maps paper mm -> image px. Output pixel (i, j)
  // sits at paper mm (x0 + (i + 0.5) * res, y0 + (j + 0.5) * res). Pixels outside the photo
  // get alpha 0.
  TT.warp = function (src, H, x0, y0, wmm, hmm, res) {
    var w = Math.round(wmm / res), h = Math.round(hmm / res);
    var out = new Uint8ClampedArray(w * h * 4), sd = src.data, sw = src.width, sh = src.height;
    for (var j = 0; j < h; j++) {
      var y = y0 + (j + 0.5) * res;
      for (var i = 0; i < w; i++) {
        var x = x0 + (i + 0.5) * res;
        var den = H[6] * x + H[7] * y + H[8];
        var u = (H[0] * x + H[1] * y + H[2]) / den - 0.5, v = (H[3] * x + H[4] * y + H[5]) / den - 0.5;
        var o = (j * w + i) * 4;
        if (den <= 0 || u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) continue;
        var u0 = u | 0, v0 = v | 0, fu = u - u0, fv = v - v0;
        var p = (v0 * sw + u0) * 4, q = p + sw * 4;
        for (var c = 0; c < 3; c++) {
          var top = sd[p + c] + (sd[p + 4 + c] - sd[p + c]) * fu;
          var bot = sd[q + c] + (sd[q + 4 + c] - sd[q + c]) * fu;
          out[o + c] = top + (bot - top) * fv;
        }
        out[o + 3] = 255;
      }
    }
    return { data: out, w: w, h: h, res: res, ox: x0, oy: y0 };
  };

  // Guess the corners of a sheet of paper: the biggest bright blob, then its extreme points
  // along the two diagonals. Returns null if the blob isn't a filled quadrilateral.
  TT.detectPaper = function (src) {
    var step = Math.max(1, Math.round(Math.max(src.width, src.height) / 700));
    var w = Math.floor(src.width / step), h = Math.floor(src.height / step), d = src.data;
    var L = new Uint8Array(w * h), hist = new Array(256).fill(0), i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      var o = ((j * step) * src.width + i * step) * 4;
      var l = (d[o] + d[o + 1] + d[o + 2]) / 3 | 0;
      L[j * w + i] = l; hist[l]++;
    }
    var total = w * h, sum = 0, sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    var mask = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) mask[i] = L[i] > thr ? 1 : 0;
    var lab = TT.components(mask, w, h), big = 0;
    for (i = 1; i < lab.areas.length; i++) if (lab.areas[i] > lab.areas[big]) big = i;
    var tl = null, tr = null, br = null, bl = null;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      if (lab.labels[j * w + i] !== big + 1) continue;
      if (!tl || i + j < tl[0] + tl[1]) tl = [i, j];
      if (!br || i + j > br[0] + br[1]) br = [i, j];
      if (!tr || i - j > tr[0] - tr[1]) tr = [i, j];
      if (!bl || i - j < bl[0] - bl[1]) bl = [i, j];
    }
    if (!tl) return null;
    var quad = Math.abs(TT.loopArea([tl, tr, br, bl])), blob = lab.areas[big];
    if (blob < 0.05 * w * h || blob / quad < 0.85 || blob / quad > 1.15) return null;
    // Use each extreme pixel's outer corner, not its centre.
    return [[tl[0], tl[1]], [tr[0] + 1, tr[1]], [br[0] + 1, br[1] + 1], [bl[0], bl[1] + 1]]
      .map(function (p) { return [p[0] * step, p[1] * step]; });
  };

  // ---------- Distance transforms and morphology ----------

  var INF = 1e20;

  function edt1d(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  // Squared distance (px) from each pixel to the nearest pixel where mask == on.
  TT.edt = function (mask, w, h, on) {
    on = on === undefined ? 1 : on;
    var g = new Float64Array(w * h), n = Math.max(w, h), i, j;
    var f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (i = 0; i < w * h; i++) g[i] = mask[i] === on ? 0 : INF;
    for (i = 0; i < w; i++) {
      for (j = 0; j < h; j++) f[j] = g[j * w + i];
      edt1d(f, h, d, v, z);
      for (j = 0; j < h; j++) g[j * w + i] = d[j];
    }
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) f[i] = g[j * w + i];
      edt1d(f, w, d, v, z);
      for (i = 0; i < w; i++) g[j * w + i] = d[i];
    }
    return g;
  };

  TT.dilate = function (mask, w, h, r) {
    if (r <= 0) return mask;
    var d = TT.edt(mask, w, h, 1), out = new Uint8Array(w * h), r2 = r * r;
    for (var i = 0; i < w * h; i++) out[i] = d[i] <= r2 ? 1 : 0;
    return out;
  };

  TT.erode = function (mask, w, h, r) {
    if (r <= 0) return mask;
    var d = TT.edt(mask, w, h, 0), out = new Uint8Array(w * h), r2 = r * r;
    for (var i = 0; i < w * h; i++) out[i] = d[i] > r2 ? 1 : 0;
    return out;
  };

  // Signed distance (in px, negative inside) of a 0/1 mask.
  TT.sdf = function (mask, w, h) {
    var din = TT.edt(mask, w, h, 0), dout = TT.edt(mask, w, h, 1), s = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) s[i] = mask[i] ? -(Math.sqrt(din[i]) - 0.5) : Math.sqrt(dout[i]) - 0.5;
    return s;
  };

  // 4-connected labelling. labels[i] = component number + 1 (0 = background).
  TT.components = function (mask, w, h) {
    var labels = new Int32Array(w * h), areas = [], stack = new Int32Array(w * h);
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || labels[s]) continue;
      var id = areas.length + 1, top = 0, area = 0;
      labels[s] = id; stack[top++] = s;
      while (top) {
        var p = stack[--top], x = p % w;
        area++;
        if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack[top++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack[top++] = p + 1; }
        if (p >= w && mask[p - w] && !labels[p - w]) { labels[p - w] = id; stack[top++] = p - w; }
        if (p < w * (h - 1) && mask[p + w] && !labels[p + w]) { labels[p + w] = id; stack[top++] = p + w; }
      }
      areas.push(area);
    }
    return { labels: labels, areas: areas };
  };

  TT.fillHoles = function (mask, w, h) {
    var inv = new Uint8Array(w * h), i;
    for (i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
    var lab = TT.components(inv, w, h), outside = {};
    for (i = 0; i < w; i++) { outside[lab.labels[i]] = 1; outside[lab.labels[(h - 1) * w + i]] = 1; }
    for (i = 0; i < h; i++) { outside[lab.labels[i * w]] = 1; outside[lab.labels[i * w + w - 1]] = 1; }
    var out = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) out[i] = mask[i] || !outside[lab.labels[i]] ? 1 : 0;
    return out;
  };

  // ---------- Segmentation ----------

  // Background colour per block, from pixels where `use` is set; empty blocks borrow from
  // their neighbours.
  function blockBackground(wp, use, bs) {
    var w = wp.w, h = wp.h, d = wp.data, bw = Math.ceil(w / bs), bh = Math.ceil(h / bs), i, j, k, c;
    var acc = new Float64Array(bw * bh * 4);
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      k = j * w + i;
      if (!use[k]) continue;
      var b = (((j / bs) | 0) * bw + ((i / bs) | 0)) * 4;
      acc[b] += d[k * 4]; acc[b + 1] += d[k * 4 + 1]; acc[b + 2] += d[k * 4 + 2]; acc[b + 3]++;
    }
    var blk = new Float32Array(bw * bh * 3), have = new Uint8Array(bw * bh), missing = 0;
    for (k = 0; k < bw * bh; k++) {
      if (acc[k * 4 + 3] > 4) { for (c = 0; c < 3; c++) blk[k * 3 + c] = acc[k * 4 + c] / acc[k * 4 + 3]; have[k] = 1; }
      else missing++;
    }
    if (missing === bw * bh) { blk.fill(200); missing = 0; }
    while (missing) {
      var next = have.slice(), before = missing;
      for (var by = 0; by < bh; by++) for (var bx = 0; bx < bw; bx++) {
        k = by * bw + bx;
        if (have[k]) continue;
        var cnt = 0, s0 = 0, s1 = 0, s2 = 0;
        for (var o = 0; o < 4; o++) {
          var x = bx + (o === 0 ? 1 : o === 1 ? -1 : 0), y = by + (o === 2 ? 1 : o === 3 ? -1 : 0);
          if (x < 0 || y < 0 || x >= bw || y >= bh || !have[y * bw + x]) continue;
          var q = (y * bw + x) * 3;
          s0 += blk[q]; s1 += blk[q + 1]; s2 += blk[q + 2]; cnt++;
        }
        if (cnt) { blk[k * 3] = s0 / cnt; blk[k * 3 + 1] = s1 / cnt; blk[k * 3 + 2] = s2 / cnt; next[k] = 1; missing--; }
      }
      have = next;
      if (missing === before) break;
    }
    // Expand to a per-pixel background image (bilinear between block centres).
    var bg = new Float32Array(w * h * 3);
    for (j = 0; j < h; j++) {
      var fy = Math.min(Math.max((j + 0.5) / bs - 0.5, 0), bh - 1), y0 = fy | 0, y1 = Math.min(y0 + 1, bh - 1), ty = fy - y0;
      for (i = 0; i < w; i++) {
        var fx = Math.min(Math.max((i + 0.5) / bs - 0.5, 0), bw - 1), x0 = fx | 0, x1 = Math.min(x0 + 1, bw - 1), tx = fx - x0;
        var a = (y0 * bw + x0) * 3, b2 = (y0 * bw + x1) * 3, c2 = (y1 * bw + x0) * 3, d2 = (y1 * bw + x1) * 3, out = (j * w + i) * 3;
        for (c = 0; c < 3; c++)
          bg[out + c] = (blk[a + c] + (blk[b2 + c] - blk[a + c]) * tx) * (1 - ty) + (blk[c2 + c] + (blk[d2 + c] - blk[c2 + c]) * tx) * ty;
      }
    }
    return bg;
  }

  // How different each pixel is from its background colour. Chroma catches coloured or grey
  // tools on a coloured mat; brightness catches dark tools on white paper.
  function score(wp, bg, lumWeight) {
    var n = wp.w * wp.h, s = new Float32Array(n), d = wp.data;
    for (var k = 0; k < n; k++) {
      var o = k * 4, b = k * 3;
      var L = d[o] + d[o + 1] + d[o + 2] + 3, Lb = bg[b] + bg[b + 1] + bg[b + 2] + 3;
      var dr = (d[o] + 1) / L - (bg[b] + 1) / Lb, dg = (d[o + 1] + 1) / L - (bg[b + 1] + 1) / Lb;
      var db = (d[o + 2] + 1) / L - (bg[b + 2] + 1) / Lb;
      var chroma2 = 9 * (dr * dr + dg * dg + db * db), lum = Math.log(L / Lb) * lumWeight;
      s[k] = Math.sqrt(chroma2 + lum * lum);
    }
    return s;
  }

  // Score image for a warped photo: rough pass against the median edge colour, then a
  // per-block background that skips the rough tool area. Slow part; cache it.
  TT.scoreImage = function (wp, threshold, lumWeight) {
    var w = wp.w, h = wp.h, n = w * h, res = wp.res, d = wp.data, i;
    var valid = new Uint8Array(n);
    for (i = 0; i < n; i++) valid[i] = d[i * 4 + 3] ? 1 : 0;
    var all = blockBackground(wp, valid, Math.round(1e9));
    var s0 = score(wp, all, lumWeight), rough = new Uint8Array(n);
    for (i = 0; i < n; i++) rough[i] = s0[i] > threshold ? 1 : 0;
    rough = TT.dilate(rough, w, h, 4 / res);
    var use = new Uint8Array(n);
    for (i = 0; i < n; i++) use[i] = valid[i] && !rough[i] ? 1 : 0;
    var bg = blockBackground(wp, use, Math.max(4, Math.round(12 / res)));
    return { score: score(wp, bg, lumWeight), valid: valid };
  };

  // opt: threshold, margin (mm), open (mm), close (mm), minArea (mm^2), fillHoles
  TT.segment = function (wp, sc, opt) {
    var w = wp.w, h = wp.h, n = w * h, res = wp.res, i, j;
    // `edge` = usable area: inside the photo and at least `margin` from its edges.
    var edge = sc.valid.slice();
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) if (i === 0 || j === 0 || i === w - 1 || j === h - 1) edge[j * w + i] = 0;
    edge = TT.erode(edge, w, h, Math.max(1, opt.margin / res));
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = sc.score[i] > opt.threshold && edge[i] ? 1 : 0;
    // Opening removes grid lines and specks, closing bridges small gaps.
    if (opt.open > 0) mask = TT.dilate(TT.erode(mask, w, h, opt.open / res), w, h, opt.open / res);
    if (opt.close > 0) mask = TT.erode(TT.dilate(mask, w, h, opt.close / res), w, h, opt.close / res);
    if (opt.fillHoles) mask = TT.fillHoles(mask, w, h);
    var lab = TT.components(mask, w, h), minPx = opt.minArea / (res * res);
    for (i = 0; i < n; i++) if (!edge[i] || (mask[i] && lab.areas[lab.labels[i] - 1] < minPx)) mask[i] = 0;
    return mask;
  };

  // Paint a brush stroke (paper mm points, radius mm) into a mask.
  TT.paint = function (mask, wp, pts, r, val) {
    var rp = r / wp.res, stepMm = Math.max(r / 3, wp.res);
    function dab(x, y) {
      var ci = (x - wp.ox) / wp.res - 0.5, cj = (y - wp.oy) / wp.res - 0.5;
      for (var j = Math.max(0, Math.floor(cj - rp)); j <= Math.min(wp.h - 1, Math.ceil(cj + rp)); j++)
        for (var i = Math.max(0, Math.floor(ci - rp)); i <= Math.min(wp.w - 1, Math.ceil(ci + rp)); i++)
          if ((i - ci) * (i - ci) + (j - cj) * (j - cj) <= rp * rp) mask[j * wp.w + i] = val;
    }
    for (var k = 0; k < pts.length; k++) {
      var a = pts[k], b = pts[k + 1] || a, len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(len / stepMm));
      for (var s = 0; s < steps; s++) dab(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps);
    }
    dab(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };

  // ---------- Contours and outlines ----------

  // Marching squares on grid values f (w x h). Region f < 0 is "inside". Returns closed loops in
  // grid units, walked with the inside on the right (y down): outer loops have negative
  // TT.loopArea in y-down coordinates. The grid border must be outside (f > 0).
  TT.contours = function (f, w, h) {
    var next = new Int32Array(w * h * 2).fill(-1), px = new Float64Array(w * h * 2), py = new Float64Array(w * h * 2);
    var starts = [];
    function val(i, j) { var v = f[j * w + i]; return v === 0 ? 1e-9 : v; }
    var ex = [0, 0, 0, 0], ey = [0, 0, 0, 0], dx = [1, 0, -1, 0], dy = [0, 1, 0, -1], v0 = [0, 0, 0, 0], v1 = [0, 0, 0, 0], id = [0, 0, 0, 0];
    var type = [0, 0, 0, 0];
    for (var j = 0; j < h - 1; j++) for (var i = 0; i < w - 1; i++) {
      var a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
      if ((a < 0) === (b < 0) && (b < 0) === (c < 0) && (c < 0) === (d < 0)) continue;
      // Cell edges walked clockwise: top, right, bottom, left.
      ex[0] = i; ey[0] = j; v0[0] = a; v1[0] = b; id[0] = (j * w + i) * 2;
      ex[1] = i + 1; ey[1] = j; v0[1] = b; v1[1] = c; id[1] = (j * w + i + 1) * 2 + 1;
      ex[2] = i + 1; ey[2] = j + 1; v0[2] = c; v1[2] = d; id[2] = ((j + 1) * w + i) * 2;
      ex[3] = i; ey[3] = j + 1; v0[3] = d; v1[3] = a; id[3] = (j * w + i) * 2 + 1;
      for (var e = 0; e < 4; e++) {
        type[e] = 0;
        if ((v0[e] < 0) === (v1[e] < 0)) continue;
        type[e] = v0[e] < 0 ? 1 : -1;
        if (type[e] === 1) {
          var t = v0[e] / (v0[e] - v1[e]);
          px[id[e]] = ex[e] + dx[e] * t; py[id[e]] = ey[e] + dy[e] * t;
        }
      }
      var centreIn = (a + b + c + d) < 0;
      for (e = 0; e < 4; e++) {
        if (type[e] !== 1) continue;
        for (var s = 1; s < 4; s++) {
          var k = centreIn ? (e + s) % 4 : (e - s + 4) % 4;
          if (type[k] === -1) { next[id[e]] = id[k]; starts.push(id[e]); break; }
        }
      }
    }
    var used = new Uint8Array(w * h * 2), loops = [];
    starts.forEach(function (s0) {
      if (used[s0]) return;
      var loop = [], e2 = s0, guard = 0;
      while (e2 >= 0 && !used[e2] && guard++ < 1e7) {
        used[e2] = 1;
        loop.push([px[e2], py[e2]]);
        e2 = next[e2];
      }
      if (loop.length >= 3) loops.push(loop.reverse()); // traced inside-on-left; flip to inside-on-right
    });
    return loops;
  };

  // Douglas-Peucker on a closed loop.
  TT.simplify = function (loop, tol) {
    var n = loop.length;
    if (n < 5) return loop;
    var far = 0, best = -1, i;
    for (i = 1; i < n; i++) {
      var dd = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
      if (dd > best) { best = dd; far = i; }
    }
    var keep = new Uint8Array(n);
    keep[0] = keep[far] = 1;
    var stack = [[0, far], [far, n]];
    while (stack.length) {
      var seg = stack.pop(), s = seg[0], e = seg[1], A = loop[s], B = loop[e % n];
      var vx = B[0] - A[0], vy = B[1] - A[1], len = Math.hypot(vx, vy) || 1e-12, md = -1, mi = -1;
      for (i = s + 1; i < e; i++) {
        var dist = Math.abs((loop[i][0] - A[0]) * vy - (loop[i][1] - A[1]) * vx) / len;
        if (dist > md) { md = dist; mi = i; }
      }
      if (md > tol) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
    }
    var out = [];
    for (i = 0; i < n; i++) {
      if (!keep[i]) continue;
      var p = loop[i], q = out[out.length - 1];
      if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
    }
    return out;
  };

  // Resample a closed loop to even spacing (returns the points; spacing may shrink slightly).
  function resample(loop, spacing) {
    var n = loop.length, per = 0, i, k;
    for (i = 0; i < n; i++) { var a = loop[i], b = loop[(i + 1) % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    var m = Math.max(8, Math.round(per / spacing)), ds = per / m, out = [], seg = 0, segPos = 0, segLen, p, q;
    for (k = 0; k < m; k++) {
      var target = k * ds;
      while (true) {
        p = loop[seg % n]; q = loop[(seg + 1) % n];
        segLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (segPos + segLen >= target || seg > 2 * n) break;
        segPos += segLen; seg++;
      }
      var t = segLen ? (target - segPos) / segLen : 0;
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    return { pts: out, ds: ds };
  }

  // Turning angle (degrees) at each point, measured over chords of k points either side, so pixel
  // noise (much shorter than the chords) hardly registers but real corners do.
  function turning(pts, k) {
    var m = pts.length, out = new Float32Array(m);
    for (var i = 0; i < m; i++) {
      var a = pts[(i - k + m) % m], p = pts[i], b = pts[(i + k) % m];
      var ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
      out[i] = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180 / Math.PI;
    }
    return out;
  }

  // Clean one traced outline without losing its real shape:
  // 1. corners (turning more than opt.corner degrees over ~2 mm) are found and pinned;
  // 2. each stretch between corners is Gaussian-smoothed (sigma opt.smooth mm) with its ends fixed,
  //    so noise goes but corners stay sharp (smoothing a gentle curve barely moves it);
  // 3. stretches that are straight to within opt.straighten mm over at least 6 mm become exact lines;
  //    curves are left as curves (no faceting).
  // Returns {pts, corners: [indices into pts]}.
  TT.cleanLoop = function (loop, opt) {
    var rs = resample(loop, opt.spacing), pts = rs.pts, ds = rs.ds, m = pts.length, i;
    // A real corner turns sharply over ~4 mm *and* still over ~8 mm; a bite or bump in the trace
    // (from glare or mat lines) only shows up at the short scale.
    var k = Math.max(2, Math.round(Math.max(4, 6 * opt.res) / ds));
    var corners = [], ang, ang2;
    if (opt.corner < 180 && m > 8 * k) {
      ang = turning(pts, k); ang2 = turning(pts, 2 * k);
      for (i = 0; i < m; i++) {
        if (ang[i] < opt.corner || ang2[i] < 0.75 * opt.corner) continue;
        var isMax = true;
        for (var d = -k; d <= k && isMax; d++) if (d && (ang[(i + d + m) % m] > ang[i] || (ang[(i + d + m) % m] === ang[i] && d < 0))) isMax = false;
        if (isMax) corners.push(i);
      }
    }
    // Stretches between corners (one closed stretch if there are none).
    var stretches = [];
    if (!corners.length) stretches.push({ closed: true, pts: pts });
    else corners.forEach(function (c, ci) {
      var e = corners[(ci + 1) % corners.length], s = [];
      for (var j = c; ; j = (j + 1) % m) { s.push(pts[j]); if (j === e && s.length > 1) break; }
      stretches.push({ closed: false, pts: s });
    });
    var out = [], outCorners = [];
    stretches.forEach(function (st) {
      var sm = opt.smooth > 0 ? robustSmooth(st.pts, st.closed, ds, 2 * opt.smooth) : st.pts;
      if (opt.straighten > 0) sm = snapLines(sm, opt.straighten, Math.max(10, 20 * opt.straighten), st.closed);
      if (!st.closed) { outCorners.push(out.length); sm = sm.slice(0, -1); } // next stretch starts with the shared corner
      for (var q2 = 0; q2 < sm.length; q2++) out.push(sm[q2]);
    });
    return { pts: out, corners: outCorners };
  };

  // Noise removal that keeps the real shape: each point is moved onto a quadratic fitted to its
  // neighbours within `half` mm (so curves keep their curvature instead of shrinking), with robust
  // re-weighting so one-sided bites and bumps (glare, mat lines) are ignored rather than averaged
  // in. Open stretches keep their end points (the corners).
  function robustSmooth(p, closed, ds, half) {
    var n = p.length, h = Math.max(2, Math.round(half / ds));
    if (!closed && n < 5) return p;
    if (closed) h = Math.min(h, (n >> 1) - 1);
    var len = 2 * h + 1, U = new Float64Array(len), V = new Float64Array(len), G = new Float64Array(len);
    var W = new Float64Array(len), R = new Float64Array(len), gs = half / 1.5, out = new Array(n);
    for (var i = 0; i < n; i++) {
      var pi = p[i];
      if (!closed && (i === 0 || i === n - 1)) { out[i] = pi; continue; }
      var lo = closed ? i - h : Math.max(0, i - h), hi = closed ? i + h : Math.min(n - 1, i + h);
      var A = p[closed ? (lo + n) % n : lo], B = p[closed ? hi % n : hi];
      var tx = B[0] - A[0], ty = B[1] - A[1], tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      var nx = -ty, ny = tx, m = 0, j, k;
      for (j = lo; j <= hi; j++, m++) {
        var q = p[closed ? (j + n) % n : j], dx = q[0] - pi[0], dy = q[1] - pi[1], u = dx * tx + dy * ty;
        U[m] = u; V[m] = dx * nx + dy * ny; G[m] = W[m] = Math.exp(-0.5 * (u / gs) * (u / gs));
      }
      var a = 0;
      for (var it = 0; it < 3; it++) {
        // Weighted least squares v = a + b u + c u^2 (3x3 normal equations, Cramer's rule).
        var s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
        for (k = 0; k < m; k++) {
          var w = W[k], u1 = U[k], u2 = u1 * u1, wv = w * V[k];
          s0 += w; s1 += w * u1; s2 += w * u2; s3 += w * u2 * u1; s4 += w * u2 * u2;
          r0 += wv; r1 += wv * u1; r2 += wv * u2;
        }
        var det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
        if (Math.abs(det) < 1e-12) break;
        a = (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det;
        var b = (s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
        var c = (s0 * (s2 * r2 - r1 * s3) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det;
        if (it === 2) break;
        // Bisquare weights from the residuals; scale from the weighted mean absolute residual
        // (at least 0.05 mm), so a bite a few mm long gets ignored instead of averaged in.
        var sa = 0, sw = 0;
        for (k = 0; k < m; k++) { R[k] = Math.abs(V[k] - (a + b * U[k] + c * U[k] * U[k])); sa += G[k] * R[k]; sw += G[k]; }
        var sc = 4.685 * Math.max(0.05, 1.25 * sa / sw);
        for (k = 0; k < m; k++) { var z = R[k] / sc; W[k] = z < 1 ? G[k] * (1 - z * z) * (1 - z * z) : 0; }
      }
      out[i] = [pi[0] + a * nx, pi[1] + a * ny];
    }
    return out;
  }

  // Replace runs that are straight to within tol (and at least minLen long) by their end points.
  // A run whose points all bow the same way is a gentle curve, not a line, and is left alone.
  function snapLines(p, tol, minLen, closed) {
    var n = p.length, out = [], s = 0;
    function dev(a, b) {
      var A = p[a], B = p[b], vx = B[0] - A[0], vy = B[1] - A[1], len = Math.hypot(vx, vy) || 1e-9, md = 0, sum = 0;
      for (var i = a + 1; i < b; i++) {
        var d = ((p[i][0] - A[0]) * vy - (p[i][1] - A[1]) * vx) / len;
        md = Math.max(md, Math.abs(d)); sum += d;
      }
      var bow = b - a > 1 ? Math.abs(sum / (b - a - 1)) : 0;
      return Math.max(md, 3 * bow);
    }
    var last = closed ? n - 1 : n - 1;
    while (s < last) {
      var e = s + 1;
      while (e + 1 <= last && dev(s, e + 1) <= tol) e++;
      if (Math.hypot(p[e][0] - p[s][0], p[e][1] - p[s][1]) >= minLen) { out.push(p[s]); s = e; }
      else { out.push(p[s]); s++; }
    }
    out.push(p[last]);
    return out;
  }

  TT.loopArea = function (loop) {
    var a = 0;
    for (var i = 0, j = loop.length - 1; i < loop.length; j = i++) a += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
    return a / 2;
  };

  TT.pointInLoop = function (p, loop) {
    var inside = false;
    for (var i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      var a = loop[i], b = loop[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };

  // ---------- Traced shapes ----------

  // Raw (uncleaned) outlines of every blob in a mask, as shapes {raw: [outer, holes...], cx, cy,
  // area, inside} in paper mm (y down). `inside` is a point inside the shape, used to recognise
  // the same shape after a re-trace. Edges are sub-pixel: the inside/outside decision comes from
  // the mask, how far each pixel is from the edge from the colour score (lightly blurred).
  TT.traceShapes = function (mask, wp, score, thr) {
    var w = wp.w + 2, h = wp.h + 2, f = new Float32Array(w * h).fill(1), i, j;
    for (j = 1; j < h - 1; j++) for (i = 1; i < w - 1; i++) {
      var x0 = i - 1, y0 = j - 1, s = 0, c = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var x = x0 + dx, y = y0 + dy;
        if (x >= 0 && y >= 0 && x < wp.w && y < wp.h) { s += score[y * wp.w + x]; c++; }
      }
      var mag = Math.min(1, Math.max(0.05, Math.abs(thr - s / c) / thr));
      f[j * w + i] = mask[y0 * wp.w + x0] ? -mag : mag;
    }
    var loops = TT.contours(f, w, h).map(function (l) {
      return l.map(function (p) { return [wp.ox + (p[0] - 0.5) * wp.res, wp.oy + (p[1] - 0.5) * wp.res]; });
    }).filter(function (l) { return l.length >= 3 && Math.abs(TT.loopArea(l)) > 4; });
    var shapes = loops.filter(function (l) { return TT.loopArea(l) < 0; }).map(function (o) {
      var a = 0, cx = 0, cy = 0;
      for (var k = 0, m = o.length - 1; k < o.length; m = k++) {
        var cr = o[m][0] * o[k][1] - o[k][0] * o[m][1];
        a += cr; cx += (o[m][0] + o[k][0]) * cr; cy += (o[m][1] + o[k][1]) * cr;
      }
      return { raw: [o], area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
    });
    loops.forEach(function (l) {
      if (TT.loopArea(l) < 0) return;
      var best = null;
      shapes.forEach(function (s) { if (TT.pointInLoop(l[0], s.raw[0]) && (!best || s.area < best.area)) best = s; });
      if (best) best.raw.push(l);
    });
    shapes.forEach(function (s) { s.inside = insidePoint(s.raw); });
    return shapes;
  };

  // A point inside the shape (not in a hole): middle of the widest inside run across the shape.
  function insidePoint(loops) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    loops[0].forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    var best = null, bestW = -1;
    for (var f = 0.2; f <= 0.81; f += 0.15) {
      var y = b[1] + (b[3] - b[1]) * f, xs = [];
      loops.forEach(function (l) {
        for (var i = 0, j = l.length - 1; i < l.length; j = i++) {
          var p = l[i], q = l[j];
          if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
        }
      });
      xs.sort(function (u, v) { return u - v; });
      for (var k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > bestW) { bestW = xs[k + 1] - xs[k]; best = [(xs[k] + xs[k + 1]) / 2, y]; }
    }
    return best || [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }

  // ---------- Symmetry ----------

  // Rasterise loops (even-odd) on a grid: pixel (i, j) centre = (x0 + (i + 0.5) g, y0 + (j + 0.5) g).
  function rasterLoops(loops, x0, y0, w, h, g) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.setTransform(1 / g, 0, 0, 1 / g, -x0 / g, -y0 / g);
    ctx.beginPath();
    loops.forEach(function (l) { l.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1]); }); ctx.closePath(); });
    ctx.fill('evenodd');
    var px = ctx.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) m[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
    return m;
  }

  function loopsBox(loops) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    loops.forEach(function (l) { l.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }); });
    return b;
  }

  // Reflect p across the line through axis.p at angle axis.a (degrees, y down).
  TT.reflect = function (axis, p) {
    var a = axis.a * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
    var d = (p[0] - axis.p[0]) * nx + (p[1] - axis.p[1]) * ny;
    return [p[0] - 2 * d * nx, p[1] - 2 * d * ny];
  };

  // Best mirror axis of a shape: the line whose reflection of the shape overlaps it most.
  // Returns {p, a (deg), score (0..1, fraction of the shape that lands on itself)}.
  TT.findAxis = function (loops) {
    var b = loopsBox(loops), g = Math.max(0.4, Math.max(b[2] - b[0], b[3] - b[1]) / 400), x0 = b[0] - 2, y0 = b[1] - 2;
    var w = Math.ceil((b[2] - b[0] + 4) / g), h = Math.ceil((b[3] - b[1] + 4) / g), m = rasterLoops(loops, x0, y0, w, h, g);
    var pts = [], cx = 0, cy = 0, i;
    for (i = 0; i < w * h; i++) if (m[i]) { var x = x0 + (i % w + 0.5) * g, y = y0 + (Math.floor(i / w) + 0.5) * g; pts.push(x, y); cx += x; cy += y; }
    var n = pts.length / 2;
    if (!n) return null;
    cx /= n; cy /= n;
    var stride = Math.max(1, Math.floor(n / 20000));
    function score(a, off) {
      var r = a * Math.PI / 180, nx = -Math.sin(r), ny = Math.cos(r), px = cx + off * nx, py = cy + off * ny, hit = 0, tot = 0;
      for (var k = 0; k < n; k += stride) {
        var qx = pts[2 * k], qy = pts[2 * k + 1], d = (qx - px) * nx + (qy - py) * ny;
        var ix = Math.floor((qx - 2 * d * nx - x0) / g), iy = Math.floor((qy - 2 * d * ny - y0) / g);
        if (ix >= 0 && iy >= 0 && ix < w && iy < h && m[iy * w + ix]) hit++;
        tot++;
      }
      return hit / tot;
    }
    var best = { a: 0, off: 0, s: -1 };
    for (var a = 0; a < 180; a += 2) { var s = score(a, 0); if (s > best.s) best = { a: a, off: 0, s: s }; }
    var a0 = best.a;
    for (var da = -2; da <= 2; da += 0.25) for (var o = -4; o <= 4; o += 0.5) {
      var s2 = score(a0 + da, o); if (s2 > best.s) best = { a: a0 + da, off: o, s: s2 };
    }
    var b0 = best;
    for (var o2 = b0.off - 0.5; o2 <= b0.off + 0.5; o2 += 0.1) { var s3 = score(b0.a, o2); if (s3 > best.s) best = { a: b0.a, off: o2, s: s3 }; }
    var r = best.a * Math.PI / 180;
    return { p: [+(cx - best.off * Math.sin(r)).toFixed(3), +(cy + best.off * Math.cos(r)).toFixed(3)], a: +(((best.a % 180) + 180) % 180).toFixed(2), score: best.s };
  };

  // Make a shape exactly symmetric about an axis by averaging it with its mirror image (mean of
  // the two signed distance fields), so small differences between the halves (photo angle,
  // tracing noise) even out instead of one side being copied.
  TT.symmetrize = function (loops, axis) {
    var all = loops.concat(loops.map(function (l) { return l.map(function (p) { return TT.reflect(axis, p); }); }));
    var b = loopsBox(all), g = 0.2, x0 = b[0] - 3, y0 = b[1] - 3;
    var w = Math.ceil((b[2] - b[0] + 6) / g), h = Math.ceil((b[3] - b[1] + 6) / g);
    var m = rasterLoops(loops, x0, y0, w, h, g), sd = TT.sdf(m, w, h), f = new Float32Array(w * h);
    function at(x, y) {
      var fx = (x - x0) / g - 0.5, fy = (y - y0) / g - 0.5;
      if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return 50;
      var i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * w + i;
      return (sd[k] * (1 - tx) + sd[k + 1] * tx) * (1 - ty) + (sd[k + w] * (1 - tx) + sd[k + w + 1] * tx) * ty;
    }
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = x0 + (i + 0.5) * g, y = y0 + (j + 0.5) * g, q = TT.reflect(axis, [x, y]);
      f[j * w + i] = (i === 0 || j === 0 || i === w - 1 || j === h - 1) ? 50 : 0.5 * (sd[j * w + i] + at(q[0], q[1]));
    }
    var out = TT.contours(f, w, h).map(function (l) {
      return l.map(function (p) { return [x0 + (p[0] + 0.5) * g, y0 + (p[1] + 0.5) * g]; });
    }).filter(function (l) { return Math.abs(TT.loopArea(l)) > 4; });
    var outers = out.filter(function (l) { return TT.loopArea(l) < 0; }).sort(function (p, q) { return TT.loopArea(p) - TT.loopArea(q); });
    if (!outers.length) return loops;
    var outer = outers[0];
    return [outer].concat(out.filter(function (l) { return TT.loopArea(l) > 0 && TT.pointInLoop(l[0], outer); }));
  };

  // Make a node loop exactly symmetric: keep the nodes on one side of the axis (nodes within
  // 0.3 mm of it are moved onto it) and replace the other side by their mirror images. Returns
  // the nodes unchanged if the loop crosses the axis more than twice.
  TT.mirrorNodes = function (nodes, axis, side) {
    var a = axis.a * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a), n = nodes.length, sg = side < 0 ? -1 : 1;
    var d = nodes.map(function (nd) { var v = sg * ((nd.x - axis.p[0]) * nx + (nd.y - axis.p[1]) * ny); return Math.abs(v) < 0.3 ? 0 : v; });
    var sideA = function (i) { return d[i] >= 0; }, start = -1, i;
    for (i = 0; i < n; i++) if (sideA(i) && !sideA((i - 1 + n) % n)) { if (start >= 0) return nodes; start = i; }
    if (start < 0) return nodes;
    var run = [];
    for (i = 0; i < n && sideA((start + i) % n); i++) {
      var nd = nodes[(start + i) % n], on = d[(start + i) % n] === 0;
      var proj = on ? (nd.x - axis.p[0]) * nx + (nd.y - axis.p[1]) * ny : 0; // moves near-axis nodes onto it
      run.push({ x: nd.x - proj * nx, y: nd.y - proj * ny, c: nd.c, s: nd.s, on: on });
    }
    if (run.length < 2) return nodes;
    var first = run[0], last = run[run.length - 1];
    if (last.on && run.length > 1) last.s = run[run.length - 2].s;
    if (!last.on) last.s = false;
    var out = run.map(function (r) { return { x: +r.x.toFixed(3), y: +r.y.toFixed(3), c: r.c, s: r.s }; });
    for (i = run.length - 1; i >= 0; i--) {
      if ((i === run.length - 1 && last.on) || (i === 0 && first.on)) continue;
      var m = TT.reflect(axis, [run[i].x, run[i].y]);
      out.push({ x: +m[0].toFixed(3), y: +m[1].toFixed(3), c: run[i].c, s: i > 0 ? run[i - 1].s : false });
    }
    return out;
  };

  // ---------- Node paths ----------
  // An outline is a closed list of nodes {x, y, c, s}: c = true for a corner (sharp), false for a
  // smooth point; s = true if the segment to the next node is a straight line. Other segments are
  // cubic Hermite curves; tangents at smooth nodes follow the neighbours (Catmull-Rom, scaled by
  // segment length so uneven spacing doesn't overshoot), or the straight segment next to them so a
  // straight edge flows into a curve without a kink. At a corner the tangent points at the neighbour.

  function segTangents(nodes, k) {
    var n = nodes.length, P = nodes[(k - 1 + n) % n], A = nodes[k], B = nodes[(k + 1) % n], Q = nodes[(k + 2) % n];
    var L = Math.hypot(B.x - A.x, B.y - A.y), m0, m1, d;
    if (A.s) return { A: A, B: B, L: L, m0: [B.x - A.x, B.y - A.y], m1: [B.x - A.x, B.y - A.y] };
    if (A.c) m0 = [B.x - A.x, B.y - A.y];
    else if (P.s) { d = Math.hypot(A.x - P.x, A.y - P.y) || 1; m0 = [(A.x - P.x) * L / d, (A.y - P.y) * L / d]; }
    else { var s0 = L / ((Math.hypot(A.x - P.x, A.y - P.y) + L) || 1); m0 = [(B.x - P.x) * s0, (B.y - P.y) * s0]; }
    if (B.c) m1 = [B.x - A.x, B.y - A.y];
    else if (B.s) { d = Math.hypot(Q.x - B.x, Q.y - B.y) || 1; m1 = [(Q.x - B.x) * L / d, (Q.y - B.y) * L / d]; }
    else { var s1 = L / ((L + Math.hypot(Q.x - B.x, Q.y - B.y)) || 1); m1 = [(Q.x - A.x) * s1, (Q.y - A.y) * s1]; }
    return { A: A, B: B, L: L, m0: m0, m1: m1 };
  }

  function hermite(s, t) {
    var t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return [h00 * s.A.x + h10 * s.m0[0] + h01 * s.B.x + h11 * s.m1[0], h00 * s.A.y + h10 * s.m0[1] + h01 * s.B.y + h11 * s.m1[1]];
  }

  // Points along segment k (node k to k+1), `step` mm apart, without the end point.
  TT.segmentPoints = function (nodes, k, step) {
    var s = segTangents(nodes, k), m = Math.max(1, Math.ceil(s.L / step)), out = [];
    for (var i = 0; i < m; i++) out.push(hermite(s, i / m));
    return out;
  };

  // The whole closed path as points.
  TT.nodePath = function (nodes, step) {
    var out = [];
    for (var k = 0; k < nodes.length; k++) out.push.apply(out, TT.segmentPoints(nodes, k, step));
    return out;
  };

  // Douglas-Peucker on an open run of a closed point list (indices a..b, wrapping); returns the
  // indices kept strictly between a and b.
  function dpIdx(pts, a, b, tol) {
    var n = pts.length, out = [], stack = [[a, b]];
    while (stack.length) {
      var sg = stack.pop(), s = sg[0], e = sg[1], A = pts[s % n], B = pts[e % n];
      var vx = B[0] - A[0], vy = B[1] - A[1], len = Math.hypot(vx, vy) || 1e-12, md = -1, mi = -1;
      for (var i = s + 1; i < e; i++) {
        var p = pts[i % n], d = Math.abs((p[0] - A[0]) * vy - (p[1] - A[1]) * vx) / len;
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol) { out.push(mi); stack.push([s, mi], [mi, e]); }
    }
    return out;
  }

  // Fit editable nodes to a raw traced loop. set: {smooth, straighten, corner, fit} (see
  // TT.cleanLoop; fit = how closely the node path must follow the cleaned outline, mm). Corners
  // come from the cleanup; smooth nodes are added where the path strays more than `fit` until it
  // follows the outline, so gentle curves get few nodes.
  TT.fitNodes = function (raw, set, res) {
    var cl = TT.cleanLoop(raw, { spacing: Math.min(0.25, res / 2), res: res, smooth: set.smooth, straighten: 0, corner: set.corner });
    var pts = cl.pts, n = pts.length, isC = new Uint8Array(n), idx = cl.corners.slice();
    idx.forEach(function (i) { isC[i] = 1; });
    if (!idx.length) {
      var far = 0, fd = -1;
      for (var i = 1; i < n; i++) { var d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
      idx = [0, far];
    }
    // Start from a coarse simplification between the fixed points, at the straight-snap tolerance:
    // runs straight to within it get no nodes in between (two corners = a straight line).
    var tol0 = Math.max(set.fit, set.straighten || 0), start = idx.slice();
    idx.forEach(function (s, k) {
      var e = idx[(k + 1) % idx.length]; if (e <= s) e += n;
      dpIdx(pts, s, e, 3 * tol0).forEach(function (j) { start.push(j % n); });
    });
    var set1 = {};
    start.forEach(function (j) { set1[j] = 1; });
    var keys = Object.keys(set1).map(Number).sort(function (a, b) { return a - b; });
    var straight = {}; // node index -> the segment after it is a straight line
    function build() { return keys.map(function (j) { return { x: pts[j][0], y: pts[j][1], c: !!isC[j], s: !!straight[j], i: j }; }); }
    // Runs that are straight to within the snap tolerance, at least 10 mm long and not bowed
    // become straight segments.
    if (set.straighten > 0) {
      var nodes0 = build();
      nodes0.forEach(function (nd, k) {
        var nx = nodes0[(k + 1) % nodes0.length], a = nd.i, b = nx.i; if (b <= a) b += n;
        var len = Math.hypot(nx.x - nd.x, nx.y - nd.y);
        if (len >= Math.max(10, 20 * set.straighten) && !dpIdx(pts, a, b, set.straighten).length && !bows(pts, a, b, set.straighten)) straight[nd.i] = 1;
      });
    }
    // Add nodes where the path strays from the outline (straight segments are left alone).
    // Each round adds the worst point of every segment that strays too far.
    for (var it = 0; it < 30; it++) {
      var nodes = build(), added = [];
      for (var k2 = 0; k2 < nodes.length; k2++) {
        var a2 = nodes[k2].i, b2 = nodes[(k2 + 1) % nodes.length].i; if (b2 <= a2) b2 += n;
        if (b2 - a2 < 2 || nodes[k2].s) continue;
        var seg = TT.segmentPoints(nodes, k2, 0.25), worst = -1, worstD = set.fit;
        seg.push([nodes[(k2 + 1) % nodes.length].x, nodes[(k2 + 1) % nodes.length].y]);
        for (var j2 = a2 + 1; j2 < b2; j2 += 2) {
          var p = pts[j2 % n], md = Infinity;
          for (var q = 0; q < seg.length; q++) {
            var ddx = seg[q][0] - p[0], ddy = seg[q][1] - p[1], dd = ddx * ddx + ddy * ddy;
            if (dd < md) md = dd;
          }
          md = Math.sqrt(md);
          if (md > worstD) { worstD = md; worst = j2 % n; }
        }
        if (worst >= 0) added.push(worst);
      }
      if (!added.length) break;
      keys = keys.concat(added).sort(function (a, b) { return a - b; });
    }
    return build().map(function (nd) { return { x: +nd.x.toFixed(3), y: +nd.y.toFixed(3), c: nd.c, s: nd.s }; });
  };

  // True if the run a..b bows consistently to one side by more than tol/3 (a gentle curve).
  function bows(pts, a, b, tol) {
    var n = pts.length, A = pts[a % n], B = pts[b % n], vx = B[0] - A[0], vy = B[1] - A[1], len = Math.hypot(vx, vy) || 1e-9, sum = 0;
    for (var i = a + 1; i < b; i++) sum += ((pts[i % n][0] - A[0]) * vy - (pts[i % n][1] - A[1]) * vx) / len;
    return b - a > 1 && Math.abs(sum / (b - a - 1)) > tol / 3;
  }

  // Nearest point on a node path to p: {k: segment, t, d: distance, pt}.
  TT.nearestOnPath = function (nodes, p) {
    var best = { d: Infinity };
    for (var k = 0; k < nodes.length; k++) {
      var s = segTangents(nodes, k), m = Math.max(8, Math.ceil(s.L / 0.5));
      for (var i = 0; i <= m; i++) {
        var q = hermite(s, i / m), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best.d) best = { k: k, t: i / m, d: d, pt: q };
      }
    }
    return best;
  };

})();
