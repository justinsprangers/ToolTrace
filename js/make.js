/* ToolTrace Make: pack prints onto build plates and write a Bambu Studio 3MF (one object per
   print, grouped into plates), following the layout of 3MFs saved by Bambu Studio 2.1. */
var TT = window.TT = window.TT || {};
(function () {
  'use strict';

  // Shelf packing. items: [{w, h, ...}] (footprints, mm); bed: square bed size (mm).
  // Returns {plates: [[{item, x, y, rot}]], tooBig: [item]}; x, y = footprint centre on the plate.
  TT.packPlates = function (items, bed, gap, margin) {
    gap = gap || 4; margin = margin || 3;
    var B = bed - 2 * margin, plates = [], tooBig = [];
    var order = items.slice().sort(function (a, b) { return Math.max(b.w, b.h) * Math.min(b.w, b.h) - Math.max(a.w, a.h) * Math.min(a.w, a.h); });
    function tryPlate(pl, it) {
      // Each orientation: an existing shelf, else a new shelf on top.
      var opts = [[it.w, it.h, false], [it.h, it.w, true]];
      for (var o = 0; o < 2; o++) {
        var w = opts[o][0], h = opts[o][1];
        if (w > B + 1e-6 || h > B + 1e-6) continue;
        for (var s = 0; s < pl.shelves.length; s++) {
          var sh = pl.shelves[s];
          if (sh.x + w <= B + 1e-6 && h <= sh.h + 1e-6) { pl.out.push({ item: it, x: margin + sh.x + w / 2, y: margin + sh.y + h / 2, rot: opts[o][2] }); sh.x += w + gap; return true; }
        }
        var top = pl.shelves.length ? pl.shelves[pl.shelves.length - 1].y + pl.shelves[pl.shelves.length - 1].h + gap : 0;
        if (top + h <= B + 1e-6) {
          pl.shelves.push({ y: top, h: h, x: w + gap });
          pl.out.push({ item: it, x: margin + w / 2, y: margin + top + h / 2, rot: opts[o][2] });
          return true;
        }
      }
      return false;
    }
    order.forEach(function (it) {
      if (Math.max(it.w, it.h) > B + 1e-6) { tooBig.push(it); return; } // square bed: turning doesn't help
      for (var i = 0; i < plates.length; i++) if (tryPlate(plates[i], it)) return;
      var pl = { shelves: [], out: [] };
      if (tryPlate(pl, it)) plates.push(pl); else tooBig.push(it);
    });
    return { plates: plates.map(function (p) { return p.out; }), tooBig: tooBig };
  };

  function uuid(n) { return ('00000000' + n.toString(16)).slice(-8) + '-71a0-4c03-9d28-80fed5dfa1dc'; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function num(v) { return +v.toFixed(4); }

  // Centre in x, y and bottom in z of a set of shells: [cx, cy, z0].
  function centreOf(shells) {
    var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    shells.forEach(function (s) {
      for (var i = 0; i < s.length; i += 3) for (var a = 0; a < 3; a++) { b[a] = Math.min(b[a], s[i + a]); b[a + 3] = Math.max(b[a + 3], s[i + a]); }
    });
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]];
  }

  // Indexed mesh text (shared vertices) for closed shells, moved so c (default: their own
  // centre and bottom) is the origin.
  function meshXml(shells, c) {
    c = c || centreOf(shells);
    var cx = c[0], cy = c[1], cz = c[2], idx = new Map(), verts = [], tris = [];
    shells.forEach(function (s) {
      for (var t = 0; t < s.length; t += 9) {
        var ids = [];
        for (var k = 0; k < 3; k++) {
          var x = num(s[t + k * 3] - cx), y = num(s[t + k * 3 + 1] - cy), z = num(s[t + k * 3 + 2] - cz), key = x + ',' + y + ',' + z;
          var id = idx.get(key);
          if (id === undefined) { id = verts.length; idx.set(key, id); verts.push('<vertex x="' + x + '" y="' + y + '" z="' + z + '"/>'); }
          ids.push(id);
        }
        if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) tris.push('<triangle v1="' + ids[0] + '" v2="' + ids[1] + '" v3="' + ids[2] + '"/>');
      }
    });
    return { xml: '<mesh><vertices>' + verts.join('') + '</vertices><triangles>' + tris.join('') + '</triangles></mesh>', n: tris.length };
  }

  // plates: [[{item: {name, shells, extruder?, parts?}, x, y, rot}]] from TT.packPlates; bed: bed
  // size (mm). item.parts = [{name, shells, extruder}] makes a multicolour object: one part per
  // filament, all in one object (Bambu paints each part with its filament). Without parts, the
  // object is item.shells on item.extruder (default 1). Returns [{name, data}] for TT.zip.
  // Plates sit on Bambu's plate grid: ceil(√n) columns, 1.2 × bed apart, rows going down (−y).
  TT.bambu3mf = function (plates, bed, title) {
    var files = [], objs = [], items = [], rels = [], cfg = [], plateCfg = [], id = 1;
    var cols = Math.ceil(Math.sqrt(plates.length)), step = bed * 1.2;
    plates.forEach(function (pl, pi) {
      var ox = (pi % cols) * step, oy = -Math.floor(pi / cols) * step, inst = [];
      pl.forEach(function (p) {
        var parts = p.item.parts || [{ name: p.item.name, shells: p.item.shells, extruder: p.item.extruder || 1 }];
        // Every part shares the whole object's centre so the parts stay in register.
        var c = centreOf([].concat.apply([], parts.map(function (q) { return q.shells; })));
        var objId = id++, comps = [], partCfg = [];
        parts.forEach(function (q, k) {
          var meshId = id++, path = '/3D/Objects/object_' + meshId + '.model', m = meshXml(q.shells, c);
          files.push({ name: path.slice(1), data: '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
            ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n  <object id="' + meshId + '" p:UUID="' + uuid(meshId) + '" type="model">' + m.xml + '</object>\n </resources>\n <build/>\n</model>\n' });
          rels.push(' <Relationship Target="' + path + '" Id="rel-' + meshId + '" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>');
          comps.push('<component p:path="' + path + '" objectid="' + meshId + '" p:UUID="' + uuid(meshId + 0x10000) + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>');
          partCfg.push('    <part id="' + meshId + '" subtype="normal_part">\n      <metadata key="name" value="' + xmlEsc(q.name || p.item.name) + '"/>\n' +
            '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="extruder" value="' + (q.extruder || 1) + '"/>\n    </part>');
        });
        objs.push('  <object id="' + objId + '" p:UUID="' + uuid(objId) + '" type="model"><components>' + comps.join('') + '</components></object>');
        var tf = (p.rot ? '0 1 0 -1 0 0 0 0 1 ' : '1 0 0 0 1 0 0 0 1 ') + num(ox + p.x) + ' ' + num(oy + p.y) + ' 0';
        items.push('  <item objectid="' + objId + '" p:UUID="' + uuid(objId + 0x20000) + '" transform="' + tf + '" printable="1"/>');
        var nm = xmlEsc(p.item.name);
        cfg.push('  <object id="' + objId + '">\n    <metadata key="name" value="' + nm + '"/>\n    <metadata key="extruder" value="' + (parts[0].extruder || 1) + '"/>\n' +
          partCfg.join('\n') + '\n  </object>');
        inst.push('    <model_instance>\n      <metadata key="object_id" value="' + objId + '"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>');
      });
      plateCfg.push('  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' + inst.join('\n') + '\n  </plate>');
    });
    files.unshift(
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n' },
      { name: '3D/3dmodel.model', data: '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
        ' <metadata name="Application">BambuStudio-02.01.01.52</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + xmlEsc(title || 'ToolTrace Gridfinity') + '</metadata>\n' +
        ' <resources>\n' + objs.join('\n') + '\n </resources>\n <build p:UUID="' + uuid(0) + '">\n' + items.join('\n') + '\n </build>\n</model>\n' },
      { name: '3D/_rels/3dmodel.model.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' + rels.join('\n') + '\n</Relationships>\n' },
      { name: 'Metadata/model_settings.config', data: '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + cfg.join('\n') + '\n' + plateCfg.join('\n') + '\n</config>\n' }
    );
    return files;
  };
})();
