/* ToolTrace 3D preview: a small software renderer (z-buffer, flat shading) for the generated bins.
   Drag to orbit, wheel to zoom. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  // meshes: [{shells: [Float32Array], ox, oy}] placed side by side.
  TT.Preview3D = function (meshes) {
    var n = 0;
    meshes.forEach(function (m) { m.shells.forEach(function (s) { n += s.length; }); });
    var v = new Float32Array(n), o = 0, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    meshes.forEach(function (m) {
      m.shells.forEach(function (s) {
        for (var i = 0; i < s.length; i += 3) {
          v[o] = s[i] + m.ox; v[o + 1] = s[i + 1] + m.oy; v[o + 2] = s[i + 2];
          for (var a = 0; a < 3; a++) { b[a] = Math.min(b[a], v[o + a]); b[a + 3] = Math.max(b[a + 3], v[o + a]); }
          o += 3;
        }
      });
    });
    this.v = v;
    this.c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    this.r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 1;
    this.hz = (b[5] - b[2]) / 2 || 1;
    this.yaw = -0.6; this.pitch = 0.9; this.zoom = 1;
  };

  TT.Preview3D.prototype.draw = function (ctx, w, h) {
    var dpr = window.devicePixelRatio || 1, W = Math.round(w * dpr), H = Math.round(h * dpr);
    var img = ctx.createImageData(W, H), px = new Uint32Array(img.data.buffer), zb = new Float32Array(W * H).fill(Infinity);
    px.fill(0xffe3e7e7); // background #e7e7e3 (ABGR)
    var v = this.v, nt = v.length / 9, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), c = this.c;
    var scale = Math.min(W, H) / (2.2 * this.r) * this.zoom, P = new Float32Array(v.length);
    for (var i = 0; i < v.length; i += 3) {
      var x = v[i] - c[0], y = v[i + 1] - c[1], z = v[i + 2] - c[2];
      var x1 = cy * x - sy * y, y1 = sy * x + cy * y;      // yaw about z
      var y2 = cp * y1 - sp * z, z2 = sp * y1 + cp * z;     // tilt towards the viewer
      P[i] = W / 2 + x1 * scale; P[i + 1] = H / 2 - z2 * scale; P[i + 2] = y2;
    }
    var Lx = 0.35, Ly = -0.5, Lz = 0.8, ll = Math.hypot(Lx, Ly, Lz);
    for (var t = 0; t < nt; t++) {
      var a = t * 9;
      var x0 = P[a], y0 = P[a + 1], xa = P[a + 3], ya = P[a + 4], xb = P[a + 6], yb = P[a + 7];
      var area = (xa - x0) * (yb - y0) - (ya - y0) * (xb - x0);
      if (area >= 0) continue; // facing away (shells are closed)
      var ux = v[a + 3] - v[a], uy = v[a + 4] - v[a + 1], uz = v[a + 5] - v[a + 2];
      var wx = v[a + 6] - v[a], wy = v[a + 7] - v[a + 1], wz = v[a + 8] - v[a + 2];
      var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, nl = Math.hypot(nx, ny, nz) || 1;
      // Light from above-front, darkened with depth so pocket floors stand out from the top.
      var zMid = (v[a + 2] + v[a + 5] + v[a + 8]) / 3 - c[2];
      var s = (0.25 + 0.75 * Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / (nl * ll))) * (0.6 + 0.4 * Math.min(1, Math.max(0, 0.5 + zMid / (2 * this.hz))));
      var col = 0xff000000 | (Math.round(70 + 175 * s) << 16) | (Math.round(66 + 165 * s) << 8) | Math.round(60 + 155 * s);
      var minX = Math.max(0, Math.floor(Math.min(x0, xa, xb))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, xa, xb)));
      var minY = Math.max(0, Math.floor(Math.min(y0, ya, yb))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, ya, yb)));
      if (minX > maxX || minY > maxY) continue;
      var z0 = P[a + 2], za = P[a + 5], zbv = P[a + 8], inv = 1 / area;
      for (var py = minY; py <= maxY; py++) {
        var cyp = py + 0.5;
        for (var pxl = minX; pxl <= maxX; pxl++) {
          var cxp = pxl + 0.5;
          var e0 = ((xa - cxp) * (yb - cyp) - (ya - cyp) * (xb - cxp)) * inv;
          var e1 = ((xb - cxp) * (y0 - cyp) - (yb - cyp) * (x0 - cxp)) * inv;
          var e2 = 1 - e0 - e1;
          if (e0 < -1e-4 || e1 < -1e-4 || e2 < -1e-4) continue;
          var zz = e0 * z0 + e1 * za + e2 * zbv, k = py * W + pxl;
          if (zz < zb[k]) { zb[k] = zz; px[k] = col; }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  };
})();
