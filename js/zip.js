/* ToolTrace zip writer (for the STL bundle and 3MF packages). Entries are deflated with the
   browser's CompressionStream when it has one, else stored. No zip64: keep under 4 GB. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  function crc32(b) {
    var c = 0xffffffff;
    for (var i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function deflate(b) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var s = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(s).arrayBuffer().then(function (a) { return new Uint8Array(a); }, function () { return null; });
  }

  // files: [{name, data: string | Uint8Array | ArrayBuffer}] → Promise<Blob>.
  TT.zip = function (files, type) {
    var enc = new TextEncoder();
    return Promise.all(files.map(function (f) {
      var raw = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(f.data);
      return deflate(raw).then(function (z) {
        var packed = z && z.length < raw.length;
        return { name: enc.encode(f.name), raw: raw, data: packed ? z : raw, method: packed ? 8 : 0, crc: crc32(raw) };
      });
    })).then(function (es) {
      var parts = [], central = [], off = 0;
      function head(sig, e, extra) {
        var h = new DataView(new ArrayBuffer(extra ? 46 : 30)), o = 0;
        h.setUint32(o, sig, true); o += 4;
        if (extra) { h.setUint16(o, 20, true); o += 2; }
        h.setUint16(o, 20, true); h.setUint16(o + 2, 0x0800, true); h.setUint16(o + 4, e.method, true);
        h.setUint16(o + 6, 0, true); h.setUint16(o + 8, 0x21, true); // time 0, date 1980-01-01
        h.setUint32(o + 10, e.crc, true); h.setUint32(o + 14, e.data.length, true); h.setUint32(o + 18, e.raw.length, true);
        h.setUint16(o + 22, e.name.length, true); h.setUint16(o + 24, 0, true);
        if (extra) h.setUint32(42, e.off, true);
        return new Uint8Array(h.buffer);
      }
      es.forEach(function (e) {
        e.off = off;
        var h = head(0x04034b50, e);
        parts.push(h, e.name, e.data);
        off += h.length + e.name.length + e.data.length;
      });
      var cdStart = off;
      es.forEach(function (e) {
        var h = head(0x02014b50, e, true);
        central.push(h, e.name);
        off += h.length + e.name.length;
      });
      var end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, es.length, true); end.setUint16(10, es.length, true);
      end.setUint32(12, off - cdStart, true); end.setUint32(16, cdStart, true);
      return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: type || 'application/zip' });
    });
  };
})();
