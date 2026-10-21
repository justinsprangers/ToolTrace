/* ToolTrace bin geometry: Gridfinity base, pocket fields, mesh and STL/SVG export.
   Layout coordinates are mm from the bin's top-left corner seen from above, y down.
   Meshes are mm with z up, y flipped so the top view matches the photo. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  var G = TT.GF = {
    pitch: 42, gap: 0.5, unitH: 7, radius: 3.75, baseH: 4.75, res: 0.2,
    // Foot profile (Gridfinity spec): 0.8 chamfer, 1.8 straight, 2.15 chamfer; ends 0.25 mm
    // inside the base slab so the bodies overlap.
    foot: [[0, 0.8 + 2.15], [0.8, 2.15], [2.6, 2.15], [4.75, 0], [5.0, 0]]
  };

  TT.binSize = function (n) { return n * G.pitch - G.gap; };

  // ---------- Layout helpers ----------

  // A library shape's loops placed in the bin (item: x, y = centre in bin mm, rot in degrees).
  TT.placeLoops = function (shape, item) {
    var a = item.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return shape.loops.map(function (l) {
      return l.map(function (p) { return [item.x + c * p[0] - s * p[1], item.y + s * p[0] + c * p[1]]; });
    });
  };

  // Bounding box of everything that gets cut, including clearance: [x0, y0, x1, y1].
  TT.layoutBox = function (L, lib) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    L.items.forEach(function (it) {
      var sh = lib[it.shapeId];
      if (!sh) return;
      TT.placeLoops(sh, it)[0].forEach(function (p) {
        b[0] = Math.min(b[0], p[0] - L.clearance); b[1] = Math.min(b[1], p[1] - L.clearance);
        b[2] = Math.max(b[2], p[0] + L.clearance); b[3] = Math.max(b[3], p[1] + L.clearance);
      });
    });
    L.notches.forEach(function (n) {
      var r = Math.max(n.d, n.len || 0) / 2;
      b[0] = Math.min(b[0], n.x - r); b[1] = Math.min(b[1], n.y - r);
      b[2] = Math.max(b[2], n.x + r); b[3] = Math.max(b[3], n.y + r);
    });
    return b[0] === Infinity ? null : b;
  };

  // Smallest bin around the layout with `wall` to spare, and the shift that centres it.
  TT.fitBin = function (L, lib) {
    var b = TT.layoutBox(L, lib);
    if (!b) return null;
    var nx = Math.max(1, Math.ceil((b[2] - b[0] + 2 * L.wall + G.gap) / G.pitch));
    var ny = Math.max(1, Math.ceil((b[3] - b[1] + 2 * L.wall + G.gap) / G.pitch));
    return { nx: nx, ny: ny, dx: TT.binSize(nx) / 2 - (b[0] + b[2]) / 2, dy: TT.binSize(ny) / 2 - (b[1] + b[3]) / 2 };
  };

  // Rotation (deg) giving a shape the smallest bounding box, laid landscape.
  TT.bestRotation = function (shape) {
    var best = 0, bestA = Infinity;
    function box(r) {
      var a = r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), b = [1e9, 1e9, -1e9, -1e9];
      shape.loops[0].forEach(function (p) {
        var x = c * p[0] - s * p[1], y = s * p[0] + c * p[1];
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
      });
      return b;
    }
    for (var r = 0; r < 180; r += 0.5) {
      var b = box(r), ar = (b[2] - b[0]) * (b[3] - b[1]);
      if (ar < bestA - 1e-6) { bestA = ar; best = r; }
    }
    var bb = box(best);
    if (bb[3] - bb[1] > bb[2] - bb[0]) best += 90;
    return best % 180;
  };

  TT.maxDepth = function (L) {
    var d = 0;
    L.items.forEach(function (it) { d = Math.max(d, it.depth); });
    L.notches.forEach(function (n) { d = Math.max(d, n.depth); });
    return d;
  };

  TT.autoHeight = function (L) {
    return Math.max(1, Math.ceil((G.baseH + L.floor + TT.maxDepth(L)) / G.unitH));
  };

  // Notch outline path: a circle (diameter d), or for a slot (len > d) the centre line of a
  // stadium len long at angle ang (deg); stroke that with lineWidth d and round caps.
  TT.notchPath = function (ctx, n) {
    ctx.beginPath();
    if (n.len > n.d) {
      var a = (n.ang || 0) * Math.PI / 180, h = (n.len - n.d) / 2, ux = Math.cos(a) * h, uy = Math.sin(a) * h;
      ctx.moveTo(n.x - ux, n.y - uy); ctx.lineTo(n.x + ux, n.y + uy);
    } else ctx.arc(n.x, n.y, n.d / 2, 0, 2 * Math.PI);
  };

  // Distance from p to a notch's edge (negative inside).
  TT.notchDist = function (n, p) {
    if (!(n.len > n.d)) return Math.hypot(p[0] - n.x, p[1] - n.y) - n.d / 2;
    var a = (n.ang || 0) * Math.PI / 180, h = (n.len - n.d) / 2, ux = Math.cos(a), uy = Math.sin(a);
    var t = Math.max(-h, Math.min(h, (p[0] - n.x) * ux + (p[1] - n.y) * uy));
    return Math.hypot(p[0] - n.x - t * ux, p[1] - n.y - t * uy) - n.d / 2;
  };

  // ---------- Pocket fields ----------

  // Distinct pocket depths, deepest first.
  function depthLevels(L) {
    var s = {};
    L.items.forEach(function (it) { s[it.depth] = 1; });
    L.notches.forEach(function (n) { s[n.depth] = 1; });
    return Object.keys(s).map(Number).filter(function (d) { return d > 0; }).sort(function (a, b) { return b - a; });
  }

  // For each depth level d (deepest first): signed distance (mm, negative = cut) of the union of
  // every pocket at least d deep, on a grid covering the bin with a 1 mm border. Sample (i, j)
  // is at bin mm (-1 + i * res, -1 + j * res). Pockets are rasterised with canvas (clearance =
  // a round-joined stroke), then turned into a distance field.
  TT.pocketFields = function (L, lib) {
    var res = G.res, W = TT.binSize(L.nx), H = TT.binSize(L.ny);
    var w = Math.round((W + 2) / res) + 1, h = Math.round((H + 2) / res) + 1;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    return depthLevels(L).map(function (d) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(1 / res, 0, 0, 1 / res, 1 / res + 0.5, 1 / res + 0.5);
      ctx.fillStyle = ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      L.items.forEach(function (it) {
        var sh = lib[it.shapeId];
        if (!sh || it.depth < d) return;
        ctx.beginPath();
        TT.placeLoops(sh, it).forEach(function (l) {
          l.forEach(function (p, k) { ctx[k ? 'lineTo' : 'moveTo'](p[0], p[1]); });
          ctx.closePath();
        });
        ctx.fill('evenodd');
        if (L.clearance > 0) { ctx.lineWidth = 2 * L.clearance; ctx.stroke(); }
      });
      L.notches.forEach(function (n) {
        if (n.depth < d) return;
        TT.notchPath(ctx, n);
        if (n.len > n.d) { ctx.lineWidth = n.d; ctx.lineCap = 'round'; ctx.stroke(); } else ctx.fill();
      });
      var px = ctx.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
      for (var i = 0; i < w * h; i++) mask[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
      var f = TT.sdf(mask, w, h);
      for (i = 0; i < w * h; i++) f[i] *= res;
      return { depth: d, f: f, w: w, h: h, res: res };
    });
  };

  // ---------- Pieces and meshes ----------

  function splitAxis(n, max) {
    var parts = Math.ceil(n / max), out = [], at = 0;
    for (var p = 0; p < parts; p++) {
      var k = Math.floor(n / parts) + (p < n % parts ? 1 : 0);
      out.push([at, k]); at += k;
    }
    return out;
  }

  // Printable pieces: [{ix, iy, kx, ky}] in grid units.
  TT.pieces = function (L) {
    var out = [];
    splitAxis(L.ny, L.maxUnits).forEach(function (py) {
      splitAxis(L.nx, L.maxUnits).forEach(function (px) { out.push({ ix: px[0], kx: px[1], iy: py[0], ky: py[1] }); });
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
  // Returns the area (mm^2) the triangulation missed, as a sanity check.
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

  // One printable bin. fields = TT.pocketFields(...). Returns {shells: [Float32Array], missingArea}.
  // Solid = feet + base slab up to the deepest pocket floor + one layer per pocket depth, each the
  // bin outline minus every pocket at least that deep.
  TT.pieceMesh = function (L, fields, pc) {
    var W = TT.binSize(pc.kx), H = TT.binSize(pc.ky), X0 = pc.ix * G.pitch, Y0 = pc.iy * G.pitch;
    var top = L.units * G.unitH, shells = [], missing = 0;

    for (var gy = 0; gy < pc.ky; gy++) for (var gx = 0; gx < pc.kx; gx++) {
      var m = new Mesh(), cx = gx * G.pitch + 20.75, cy = H - (gy * G.pitch + 20.75);
      loft(m, G.foot.map(function (f) {
        return { z: f[0], pts: roundRect(cx, cy, 41.5 - 2 * f[1], 41.5 - 2 * f[1], G.radius - f[1], 8) };
      }));
      shells.push(m);
    }

    var floors = fields.map(function (f) { return top - f.depth; }), firstFloor = floors.length ? floors[0] : top;
    var body = new Mesh(), outline = roundRect(W / 2, H / 2, W, H, G.radius, 8);
    loft(body, [{ z: G.baseH, pts: outline }, { z: firstFloor, pts: outline }]);
    shells.push(body);

    // Layers: one per pocket depth. The top edge chamfer (45°, L.chamfer mm, kept shallower than
    // the shallowest pocket) is printed as thin steps (~0.2 mm, about one print layer), each with
    // every pocket grown by its height above the chamfer start.
    var layers = [];
    fields.forEach(function (pf, k) {
      var z0 = floors[k], z1 = k + 1 < floors.length ? floors[k + 1] : top;
      if (k === fields.length - 1 && L.chamfer > 0) {
        var c = Math.min(L.chamfer, z1 - z0 - 0.6);
        if (c > 0.05) {
          var n = Math.max(2, Math.ceil(c / 0.2));
          layers.push({ pf: pf, z0: z0, z1: top - c, off: 0 });
          for (var s = 1; s <= n; s++) layers.push({ pf: pf, z0: top - c + (s - 1) * c / n, z1: top - c + s * c / n, off: s * c / n });
          return;
        }
      }
      layers.push({ pf: pf, z0: z0, z1: z1, off: 0 });
    });
    layers.forEach(function (ly) {
      var pf = ly.pf, z0 = ly.z0, z1 = ly.z1;
      if (z1 - z0 < 1e-6) return;
      var i0 = Math.round(X0 / pf.res), j0 = Math.round(Y0 / pf.res);
      var w = Math.round((W + 2) / pf.res) + 1, h = Math.round((H + 2) / pf.res) + 1, g = new Float32Array(w * h);
      for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
        var x = -1 + i * pf.res, y = -1 + j * pf.res;
        g[j * w + i] = Math.max(sdRoundRect(x, y, W / 2, H / 2, W / 2, H / 2, G.radius), -(pf.f[(j + j0) * pf.w + (i + i0)] - ly.off));
      }
      var loops = TT.contours(g, w, h).map(function (l) {
        return TT.simplify(l, 0.04).map(function (p) { return [-1 + p[0] * pf.res, H - (-1 + p[1] * pf.res)]; });
      }).filter(function (l) { return l.length >= 3; });
      var layer = new Mesh();
      missing += prism(layer, loops, z0 - 0.2, z1);
      shells.push(layer);
    });
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

  // Signed volume of a closed shell (positive when faces point outwards).
  TT.volume = function (v) {
    var V = 0;
    for (var t = 0; t < v.length; t += 9)
      V += (v[t] * (v[t + 4] * v[t + 8] - v[t + 5] * v[t + 7]) - v[t + 1] * (v[t + 3] * v[t + 8] - v[t + 5] * v[t + 6]) +
            v[t + 2] * (v[t + 3] * v[t + 7] - v[t + 4] * v[t + 6])) / 6;
    return V;
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

  // 1:1 SVG (mm) of the bin outline(s) and the pocket outline at each depth.
  TT.svg = function (L, fields) {
    var W = TT.binSize(L.nx), H = TT.binSize(L.ny), parts = [], colours = ['#ff0000', '#0000ff', '#00a000', '#ff8800'];
    TT.pieces(L).forEach(function (pc) {
      parts.push('<rect x="' + (pc.ix * G.pitch) + '" y="' + (pc.iy * G.pitch) + '" width="' + TT.binSize(pc.kx) +
        '" height="' + TT.binSize(pc.ky) + '" rx="' + G.radius + '" stroke="#000000"/>');
    });
    fields.forEach(function (pf, k) {
      TT.contours(pf.f, pf.w, pf.h).forEach(function (l) {
        l = TT.simplify(l, 0.03);
        parts.push('<path stroke="' + colours[k % colours.length] + '" d="M' + l.map(function (p) {
          return (-1 + p[0] * pf.res).toFixed(3) + ' ' + (-1 + p[1] * pf.res).toFixed(3);
        }).join('L') + 'Z"/>');
      });
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H + 'mm" viewBox="0 0 ' + W + ' ' + H +
      '"><g fill="none" stroke-width="0.1">' + parts.join('') + '</g></svg>';
  };
})();
