/* ToolTrace bin geometry: Gridfinity base, pocket field, mesh and STL/SVG export.
   Bin coordinates are mm, origin at the bin's top-left corner seen from above, y down.
   Meshes are mm with z up, y flipped so the top view matches the photo. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  var G = TT.GF = {
    pitch: 42, gap: 0.5, unitH: 7, radius: 3.75, baseH: 4.75, floor: 1.2, res: 0.25,
    // Foot profile (Gridfinity spec): 0.8 chamfer, 1.8 straight, 2.15 chamfer.
    foot: [[0, 0.8 + 2.15], [0.8, 2.15], [2.6, 2.15], [4.75, 0], [5.0, 0]]
  };

  TT.binSize = function (n) { return n * G.pitch - G.gap; };

  // Bin-space point -> paper-space point for a tool placed with rotation `rot` (deg) and
  // offset `off` from the bin centre.
  TT.binToPaper = function (d, x, y) {
    var a = -d.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var u = x - TT.binSize(d.nx) / 2 - d.offX, v = y - TT.binSize(d.ny) / 2 - d.offY;
    return [d.tool.cx + c * u - s * v, d.tool.cy + s * u + c * v];
  };

  TT.paperToBin = function (d, x, y) {
    var a = d.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var u = x - d.tool.cx, v = y - d.tool.cy;
    return [TT.binSize(d.nx) / 2 + d.offX + c * u - s * v, TT.binSize(d.ny) / 2 + d.offY + s * u + c * v];
  };

  // Tool outline extents after rotation, relative to the tool centroid.
  TT.rotatedBox = function (tool, rot) {
    var a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), b = [1e9, 1e9, -1e9, -1e9];
    tool.loops.forEach(function (loop) {
      loop.forEach(function (p) {
        var u = p[0] - tool.cx, v = p[1] - tool.cy, x = c * u - s * v, y = s * u + c * v;
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
      });
    });
    return b;
  };

  // Rotation (deg) giving the smallest bounding box, laid landscape.
  TT.bestRotation = function (tool) {
    var best = 0, bestA = Infinity;
    for (var r = 0; r < 180; r += 0.5) {
      var b = TT.rotatedBox(tool, r), a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < bestA - 1e-6) { bestA = a; best = r; }
    }
    var bb = TT.rotatedBox(tool, best);
    if (bb[3] - bb[1] > bb[2] - bb[0]) best += 90;
    return best % 180;
  };

  // Units needed in x and y for the tool + clearance + wall, and the offset that centres it.
  TT.autoFit = function (d) {
    var b = TT.rotatedBox(d.tool, d.rot), pad = 2 * (d.clearance + d.wall) + G.gap;
    return {
      nx: Math.max(1, Math.ceil((b[2] - b[0] + pad) / G.pitch)),
      ny: Math.max(1, Math.ceil((b[3] - b[1] + pad) / G.pitch)),
      offX: -(b[0] + b[2]) / 2, offY: -(b[1] + b[3]) / 2
    };
  };

  TT.autoHeight = function (depth) {
    return Math.max(1, Math.ceil((G.baseH + G.floor + depth) / G.unitH));
  };

  // Pocket signed distance (mm, negative = cut) sampled on a grid covering the whole bin with
  // a 1 mm border. Sample (i, j) is at bin mm (-1 + i * res, -1 + j * res).
  TT.pocketField = function (d) {
    var res = G.res, W = TT.binSize(d.nx), H = TT.binSize(d.ny);
    var w = Math.round((W + 2) / res) + 1, h = Math.round((H + 2) / res) + 1;
    var f = new Float32Array(w * h), nr = d.notchD / 2;
    var a = -d.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = d.tool;
    for (var j = 0; j < h; j++) {
      var y = -1 + j * res;
      for (var i = 0; i < w; i++) {
        var x = -1 + i * res, u = x - W / 2 - d.offX, v = y - H / 2 - d.offY;
        var val = TT.toolSdf(t, t.cx + c * u - s * v, t.cy + s * u + c * v) - d.clearance;
        for (var k = 0; k < d.notches.length; k++) {
          var nv = Math.hypot(x - d.notches[k][0], y - d.notches[k][1]) - nr;
          if (nv < val) val = nv;
        }
        f[j * w + i] = val;
      }
    }
    return { f: f, w: w, h: h, res: res };
  };

  function splitAxis(n, max) {
    var parts = Math.ceil(n / max), out = [], at = 0;
    for (var p = 0; p < parts; p++) {
      var k = Math.floor(n / parts) + (p < n % parts ? 1 : 0);
      out.push([at, k]); at += k;
    }
    return out;
  }

  // Printable pieces: [{ix, iy, kx, ky}] in grid units.
  TT.pieces = function (d) {
    var out = [];
    splitAxis(d.ny, d.maxUnits).forEach(function (py) {
      splitAxis(d.nx, d.maxUnits).forEach(function (px) {
        out.push({ ix: px[0], kx: px[1], iy: py[0], ky: py[1] });
      });
    });
    return out;
  };

  function sdRoundRect(x, y, cx, cy, hw, hh, r) {
    var qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }

  // Rounded rectangle centred at (cx, cy), counter-clockwise (y up).
  function roundRect(cx, cy, w, h, r, seg) {
    var pts = [], corners = [[1, -1, -90], [1, 1, 0], [-1, 1, 90], [-1, -1, 180]];
    corners.forEach(function (k) {
      var ox = cx + k[0] * (w / 2 - r), oy = cy + k[1] * (h / 2 - r);
      for (var i = 0; i <= seg; i++) {
        var a = (k[2] + 90 * i / seg) * Math.PI / 180;
        pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
      }
    });
    return pts;
  }

  function Mesh() { this.v = []; }
  Mesh.prototype.tri = function (a, b, c) { this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  Mesh.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };

  // Closed solid between stacked convex rings [{pts, z}], bottom to top.
  function loft(m, rings) {
    var n = rings[0].pts.length, i, k;
    for (k = 0; k + 1 < rings.length; k++) {
      var A = rings[k], B = rings[k + 1];
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n;
        m.quad([A.pts[i][0], A.pts[i][1], A.z], [A.pts[j][0], A.pts[j][1], A.z],
               [B.pts[j][0], B.pts[j][1], B.z], [B.pts[i][0], B.pts[i][1], B.z]);
      }
    }
    var lo = rings[0], hi = rings[rings.length - 1];
    for (i = 1; i + 1 < n; i++) {
      m.tri([lo.pts[0][0], lo.pts[0][1], lo.z], [lo.pts[i + 1][0], lo.pts[i + 1][1], lo.z], [lo.pts[i][0], lo.pts[i][1], lo.z]);
      m.tri([hi.pts[0][0], hi.pts[0][1], hi.z], [hi.pts[i][0], hi.pts[i][1], hi.z], [hi.pts[i + 1][0], hi.pts[i + 1][1], hi.z]);
    }
  }

  // Closed prism of polygon loops (solid on the left of every loop, y up) from z0 to z1.
  function prism(m, loops, z0, z1) {
    var outers = [], holes = [];
    loops.forEach(function (l) { (TT.loopArea(l) > 0 ? outers : holes).push(l); });
    var groups = outers.map(function (o) { return { outer: o, holes: [], area: TT.loopArea(o) }; });
    holes.forEach(function (hl) {
      var best = null;
      groups.forEach(function (g) {
        if (TT.pointInLoop(hl[0], g.outer) && (!best || g.area < best.area)) best = g;
      });
      if (best) best.holes.push(hl);
    });
    var missing = 0;
    groups.forEach(function (g) {
      var flat = [], idx = [], pts = [];
      [g.outer].concat(g.holes).forEach(function (l, li) {
        if (li) idx.push(pts.length);
        l.forEach(function (p) { flat.push(p[0], p[1]); pts.push(p); });
      });
      var t = TT.earcut(flat, idx), got = 0;
      for (var i = 0; i < t.length; i += 3) {
        var a = pts[t[i]], b = pts[t[i + 1]], c = pts[t[i + 2]];
        var ar = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (ar < 0) { var tmp = b; b = c; c = tmp; }
        got += Math.abs(ar) / 2;
        m.tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]);
        m.tri([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]);
      }
      var want = g.area;
      g.holes.forEach(function (hl) { want += TT.loopArea(hl); });
      missing += Math.abs(want - got);
    });
    loops.forEach(function (l) {
      for (var i = 0; i < l.length; i++) {
        var p = l[i], q = l[(i + 1) % l.length];
        m.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]);
      }
    });
    return missing;
  }

  // One printable bin. Returns {shells: [Float32Array], missingArea}.
  TT.pieceMesh = function (d, pf, pc) {
    var W = TT.binSize(pc.kx), H = TT.binSize(pc.ky), X0 = pc.ix * G.pitch, Y0 = pc.iy * G.pitch;
    var top = d.units * G.unitH, floorZ = top - d.depth, shells = [];

    for (var gy = 0; gy < pc.ky; gy++) for (var gx = 0; gx < pc.kx; gx++) {
      var m = new Mesh(), cx = gx * G.pitch + 20.75, cy = H - (gy * G.pitch + 20.75);
      loft(m, G.foot.map(function (f) {
        return { z: f[0], pts: roundRect(cx, cy, 41.5 - 2 * f[1], 41.5 - 2 * f[1], G.radius - f[1], 8) };
      }));
      shells.push(m);
    }

    var body = new Mesh(), outline = roundRect(W / 2, H / 2, W, H, G.radius, 8);
    loft(body, [{ z: G.baseH, pts: outline }, { z: floorZ, pts: outline }]);
    shells.push(body);

    // Layer above the pocket floor: bin outline minus the pocket, on this piece's slice of the grid.
    var i0 = Math.round(X0 / pf.res), j0 = Math.round(Y0 / pf.res);
    var w = Math.round((W + 2) / pf.res) + 1, h = Math.round((H + 2) / pf.res) + 1, g = new Float32Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = -1 + i * pf.res, y = -1 + j * pf.res;
      var rect = sdRoundRect(x, y, W / 2, H / 2, W / 2, H / 2, G.radius);
      var pocket = pf.f[(j + j0) * pf.w + (i + i0)];
      g[j * w + i] = Math.max(rect, -pocket);
    }
    var loops = TT.contours(g, w, h).map(function (l) {
      return TT.simplify(l, 0.02).map(function (p) { return [-1 + p[0] * pf.res, H - (-1 + p[1] * pf.res)]; });
    }).filter(function (l) { return l.length >= 3; });
    var upper = new Mesh(), missing = prism(upper, loops, floorZ - 0.2, top);
    shells.push(upper);
    return { shells: shells.map(function (s) { return new Float32Array(s.v); }), missingArea: missing };
  };

  // Every edge of a closed shell must be matched by the reverse edge. Returns unmatched count.
  TT.openEdges = function (v) {
    var cnt = new Map(), key = function (i) { return v[i].toFixed(4) + ',' + v[i + 1].toFixed(4) + ',' + v[i + 2].toFixed(4); };
    for (var t = 0; t < v.length; t += 9) {
      var k = [key(t), key(t + 3), key(t + 6)];
      for (var e = 0; e < 3; e++) {
        var a = k[e], b = k[(e + 1) % 3], fwd = a + '>' + b, rev = b + '>' + a;
        if (cnt.get(rev)) { cnt.set(rev, cnt.get(rev) - 1); if (!cnt.get(rev)) cnt.delete(rev); }
        else cnt.set(fwd, (cnt.get(fwd) || 0) + 1);
      }
    }
    var open = 0;
    cnt.forEach(function (c) { open += c; });
    return open;
  };

  TT.stl = function (shells) {
    var n = 0;
    shells.forEach(function (s) { n += s.length / 9; });
    var buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), o = 84;
    var head = 'ToolTrace Gridfinity bin';
    for (var c = 0; c < head.length; c++) dv.setUint8(c, head.charCodeAt(c));
    dv.setUint32(80, n, true);
    shells.forEach(function (v) {
      for (var t = 0; t < v.length; t += 9) {
        var ux = v[t + 3] - v[t], uy = v[t + 4] - v[t + 1], uz = v[t + 5] - v[t + 2];
        var wx = v[t + 6] - v[t], wy = v[t + 7] - v[t + 1], wz = v[t + 8] - v[t + 2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
        dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
        for (var k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, v[t + k], true);
        o += 50;
      }
    });
    return buf;
  };

  // 1:1 SVG (mm) of the bin outline(s) and pocket outline, e.g. for a laser-cut foam insert.
  TT.svg = function (d, pf) {
    var W = TT.binSize(d.nx), H = TT.binSize(d.ny), parts = [];
    TT.pieces(d).forEach(function (pc) {
      parts.push('<rect x="' + (pc.ix * G.pitch).toFixed(3) + '" y="' + (pc.iy * G.pitch).toFixed(3) +
        '" width="' + TT.binSize(pc.kx) + '" height="' + TT.binSize(pc.ky) + '" rx="' + G.radius + '"/>');
    });
    TT.contours(pf.f, pf.w, pf.h).forEach(function (l) {
      l = TT.simplify(l, 0.02);
      parts.push('<path d="M' + l.map(function (p) {
        return (-1 + p[0] * pf.res).toFixed(3) + ' ' + (-1 + p[1] * pf.res).toFixed(3);
      }).join('L') + 'Z"/>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H + 'mm" viewBox="0 0 ' + W + ' ' + H +
      '"><g fill="none" stroke="#ff0000" stroke-width="0.1">' + parts.join('') + '</g></svg>';
  };
})();
