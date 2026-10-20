/* ToolTrace vision: perspective correction, tool segmentation, distance transforms and contours.
   Image coordinates are pixels with y down. Paper coordinates are mm with y down, origin at the
   reference rectangle's top-left corner. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  // ---------- Perspective ----------

  function solve(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) A[i] = A[i].concat([b[i]]);
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

  // 3x3 homography (row-major, 9 numbers) mapping 4 `from` points onto 4 `to` points.
  TT.homography = function (from, to) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    h.push(1);
    return h;
  };

  TT.applyH = function (h, x, y) {
    var w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };

  // Sort 4 clicked corners into top-left, top-right, bottom-right, bottom-left (image y down).
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

  // Which way round the reference rectangle lies: returns [width, height] in mm so that the
  // longer side follows whichever pair of photo edges is longer.
  TT.fitRef = function (c, a, b) {
    var d = function (p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); };
    var across = d(c[0], c[1]) + d(c[3], c[2]), down = d(c[0], c[3]) + d(c[1], c[2]);
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return across >= down ? [hi, lo] : [lo, hi];
  };

  // Resample the photo onto a flat paper grid. Output pixel (i, j) sits at paper mm
  // (-ext + (i + 0.5) * res, -ext + (j + 0.5) * res).
  TT.warp = function (src, corners, refW, refH, ext, res) {
    var H = TT.homography([[0, 0], [refW, 0], [refW, refH], [0, refH]], corners);
    var w = Math.round((refW + 2 * ext) / res), h = Math.round((refH + 2 * ext) / res);
    var out = new Uint8ClampedArray(w * h * 4), sd = src.data, sw = src.width, sh = src.height;
    for (var j = 0; j < h; j++) {
      var y = -ext + (j + 0.5) * res;
      for (var i = 0; i < w; i++) {
        var x = -ext + (i + 0.5) * res;
        var den = H[6] * x + H[7] * y + H[8];
        var u = (H[0] * x + H[1] * y + H[2]) / den - 0.5, v = (H[3] * x + H[4] * y + H[5]) / den - 0.5;
        var o = (j * w + i) * 4;
        if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) { out[o + 3] = 255; continue; }
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
    return { data: out, w: w, h: h, res: res, ox: -ext, oy: -ext };
  };

  // Guess the corners of a sheet of paper: the biggest bright blob, then its extreme points
  // along the two diagonals.
  TT.detectPaper = function (src) {
    var step = Math.max(1, Math.round(Math.max(src.width, src.height) / 700));
    var w = Math.floor(src.width / step), h = Math.floor(src.height / step), d = src.data;
    var L = new Uint8Array(w * h), hist = new Array(256).fill(0), i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      var o = ((j * step) * src.width + i * step) * 4;
      var l = (d[o] + d[o + 1] + d[o + 2]) / 3 | 0;
      L[j * w + i] = l; hist[l]++;
    }
    // Otsu threshold
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
    // Reject blobs that aren't a filled quadrilateral (e.g. a strip of bright countertop).
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

  // How different each pixel is from the local background colour. Chroma catches coloured or
  // grey tools on a coloured mat; brightness catches dark tools on white paper.
  function scoreAll(wp, bgAt, lumWeight) {
    var n = wp.w * wp.h, s = new Float32Array(n), d = wp.data, bg = [0, 0, 0];
    for (var j = 0; j < wp.h; j++) for (var i = 0; i < wp.w; i++) {
      var k = j * wp.w + i, o = k * 4;
      bgAt(i, j, bg);
      var L = d[o] + d[o + 1] + d[o + 2] + 3, Lb = bg[0] + bg[1] + bg[2] + 3;
      var dr = (d[o] + 1) / L - (bg[0] + 1) / Lb, dg = (d[o + 1] + 1) / L - (bg[1] + 1) / Lb;
      var db = (d[o + 2] + 1) / L - (bg[2] + 1) / Lb;
      var chroma = 3 * Math.sqrt(dr * dr + dg * dg + db * db), lum = Math.log(L / Lb) * lumWeight;
      s[k] = Math.sqrt(chroma * chroma + lum * lum);
    }
    return s;
  }

  function median(arr) {
    arr.sort(function (a, b) { return a - b; });
    return arr.length ? arr[arr.length >> 1] : 128;
  }

  // opt: threshold, lumWeight, margin (mm), open (mm), close (mm), minArea (mm^2), fillHoles
  TT.segment = function (wp, opt) {
    var w = wp.w, h = wp.h, n = w * h, d = wp.data, res = wp.res, i, j, k;
    var m = Math.max(1, Math.round(opt.margin / res));
    var edge = new Uint8Array(n);
    for (j = 0; j < h; j++) for (i = 0; i < w; i++)
      if (i < m || j < m || i >= w - m || j >= h - m) edge[j * w + i] = 1;

    // Pass 1: one background colour taken from a band just inside the margin.
    var band = m + Math.round(10 / res), R = [], G = [], B = [];
    for (j = 0; j < h; j += 2) for (i = 0; i < w; i += 2) {
      if (edge[j * w + i] || (i >= band && j >= band && i < w - band && j < h - band)) continue;
      k = (j * w + i) * 4; R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]);
    }
    var g0 = [median(R), median(G), median(B)];
    var s0 = scoreAll(wp, function (x, y, out) { out[0] = g0[0]; out[1] = g0[1]; out[2] = g0[2]; }, opt.lumWeight);
    var rough = new Uint8Array(n);
    for (i = 0; i < n; i++) rough[i] = s0[i] > opt.threshold && !edge[i] ? 1 : 0;
    rough = TT.dilate(rough, w, h, 4 / res);

    // Pass 2: background colour per ~12 mm block, from pixels away from the rough tool mask.
    var bs = Math.max(4, Math.round(12 / res)), bw = Math.ceil(w / bs), bh = Math.ceil(h / bs);
    var acc = new Float64Array(bw * bh * 4);
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      k = j * w + i;
      if (rough[k] || edge[k]) continue;
      var b = (((j / bs) | 0) * bw + ((i / bs) | 0)) * 4;
      acc[b] += d[k * 4]; acc[b + 1] += d[k * 4 + 1]; acc[b + 2] += d[k * 4 + 2]; acc[b + 3]++;
    }
    var blk = new Float64Array(bw * bh * 3), have = new Uint8Array(bw * bh), missing = 0;
    for (k = 0; k < bw * bh; k++) {
      if (acc[k * 4 + 3] > 8) {
        for (var c = 0; c < 3; c++) blk[k * 3 + c] = acc[k * 4 + c] / acc[k * 4 + 3];
        have[k] = 1;
      } else missing++;
    }
    if (missing === bw * bh) { for (k = 0; k < bw * bh; k++) { blk.set(g0, k * 3); have[k] = 1; } missing = 0; }
    while (missing) {
      var next = have.slice();
      for (var by = 0; by < bh; by++) for (var bx = 0; bx < bw; bx++) {
        k = by * bw + bx;
        if (have[k]) continue;
        var cnt = 0, sum = [0, 0, 0];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          var x = bx + o[0], y = by + o[1];
          if (x < 0 || y < 0 || x >= bw || y >= bh || !have[y * bw + x]) return;
          for (var c2 = 0; c2 < 3; c2++) sum[c2] += blk[(y * bw + x) * 3 + c2];
          cnt++;
        });
        if (cnt) { for (var c3 = 0; c3 < 3; c3++) blk[k * 3 + c3] = sum[c3] / cnt; next[k] = 1; missing--; }
      }
      have = next;
    }
    var bgAt = function (x, y, out) {
      var fx = Math.min(Math.max((x + 0.5) / bs - 0.5, 0), bw - 1), fy = Math.min(Math.max((y + 0.5) / bs - 0.5, 0), bh - 1);
      var x0 = fx | 0, y0 = fy | 0, x1 = Math.min(x0 + 1, bw - 1), y1 = Math.min(y0 + 1, bh - 1), tx = fx - x0, ty = fy - y0;
      for (var c4 = 0; c4 < 3; c4++) {
        var a = blk[(y0 * bw + x0) * 3 + c4], b2 = blk[(y0 * bw + x1) * 3 + c4];
        var cc = blk[(y1 * bw + x0) * 3 + c4], dd = blk[(y1 * bw + x1) * 3 + c4];
        out[c4] = (a + (b2 - a) * tx) * (1 - ty) + (cc + (dd - cc) * tx) * ty;
      }
    };
    var score = scoreAll(wp, bgAt, opt.lumWeight);
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = score[i] > opt.threshold && !edge[i] ? 1 : 0;

    // Clean up: opening removes grid lines and specks, closing bridges small gaps.
    if (opt.open > 0) mask = TT.dilate(TT.erode(mask, w, h, opt.open / res), w, h, opt.open / res);
    if (opt.close > 0) mask = TT.erode(TT.dilate(mask, w, h, opt.close / res), w, h, opt.close / res);
    if (opt.fillHoles) mask = TT.fillHoles(mask, w, h);
    var lab = TT.components(mask, w, h), minPx = opt.minArea / (res * res);
    for (i = 0; i < n; i++) if (mask[i] && lab.areas[lab.labels[i] - 1] < minPx) mask[i] = 0;
    for (i = 0; i < n; i++) if (edge[i]) mask[i] = 0;
    return { mask: mask, score: score };
  };

  // Signed distance field of the tool mask in mm (negative inside), plus its outline.
  TT.toolFromMask = function (mask, w, h, res, ox, oy) {
    var din = TT.edt(mask, w, h, 0), dout = TT.edt(mask, w, h, 1), n = w * h;
    var sdf = new Float32Array(n), cx = 0, cy = 0, area = 0;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var k = j * w + i;
      if (mask[k]) {
        sdf[k] = -(Math.sqrt(din[k]) - 0.5) * res;
        cx += i; cy += j; area++;
      } else sdf[k] = (Math.sqrt(dout[k]) - 0.5) * res;
    }
    if (!area) return null;
    var loops = TT.contours(sdf, w, h).map(function (loop) {
      return TT.simplify(loop, 0.1).map(function (p) { return [ox + (p[0] + 0.5) * res, oy + (p[1] + 0.5) * res]; });
    });
    return {
      sdf: sdf, w: w, h: h, res: res, ox: ox, oy: oy, loops: loops, area: area * res * res,
      cx: ox + (cx / area + 0.5) * res, cy: oy + (cy / area + 0.5) * res
    };
  };

  // Tool signed distance (mm) at paper point (x, y), bilinear; far outside the photo = +big.
  TT.toolSdf = function (t, x, y) {
    var fx = (x - t.ox) / t.res - 0.5, fy = (y - t.oy) / t.res - 0.5;
    if (fx < 0 || fy < 0 || fx >= t.w - 1 || fy >= t.h - 1) return 1e3;
    var i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * t.w + i, s = t.sdf;
    return (s[k] + (s[k + 1] - s[k]) * tx) * (1 - ty) + (s[k + t.w] + (s[k + t.w + 1] - s[k + t.w]) * tx) * ty;
  };

  // ---------- Contours ----------

  // Marching squares on grid values f (w x h). Region f < 0 is "inside". Returns closed loops in
  // grid units, walked with the inside on the right (y down), i.e. on the left once y is flipped up.
  // The grid border must be outside (f > 0).
  TT.contours = function (f, w, h) {
    var next = new Int32Array(w * h * 2).fill(-1), px = new Float64Array(w * h * 2), py = new Float64Array(w * h * 2);
    var starts = [];
    function val(i, j) { var v = f[j * w + i]; return v === 0 ? 1e-9 : v; }
    var ex = new Array(4), ey = new Array(4), ev = new Array(4), id = new Array(4), dx = new Array(4), dy = new Array(4);
    for (var j = 0; j < h - 1; j++) for (var i = 0; i < w - 1; i++) {
      var a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
      if ((a < 0) === (b < 0) && (b < 0) === (c < 0) && (c < 0) === (d < 0)) continue;
      // Cell edges walked clockwise: top, right, bottom, left.
      ex[0] = i; ey[0] = j; dx[0] = 1; dy[0] = 0; ev[0] = [a, b]; id[0] = (j * w + i) * 2;
      ex[1] = i + 1; ey[1] = j; dx[1] = 0; dy[1] = 1; ev[1] = [b, c]; id[1] = (j * w + i + 1) * 2 + 1;
      ex[2] = i + 1; ey[2] = j + 1; dx[2] = -1; dy[2] = 0; ev[2] = [c, d]; id[2] = ((j + 1) * w + i) * 2;
      ex[3] = i; ey[3] = j + 1; dx[3] = 0; dy[3] = -1; ev[3] = [d, a]; id[3] = (j * w + i) * 2 + 1;
      var type = [0, 0, 0, 0];
      for (var e = 0; e < 4; e++) {
        var v0 = ev[e][0], v1 = ev[e][1];
        if ((v0 < 0) === (v1 < 0)) continue;
        type[e] = v0 < 0 ? 1 : -1; // 1 = leaves the inside (segment start), -1 = enters (segment end)
        if (type[e] === 1) {
          var t = v0 / (v0 - v1);
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
})();
