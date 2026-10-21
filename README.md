# ToolTrace

Turn photos of your tools into Gridfinity bins with a pocket shaped like each tool. Works offline: double-click `index.html`. Nothing to install.

It works in three steps (tabs at the top).

## 1. Capture: photo → outlines
1. **Photo:** choose a photo of one or more tools lying flat.
2. **Scale reference:** pick one.
   - **Paper** (most reliable): tools on plain white paper. The app finds the paper corners. Drag the handles if they're off.
   - **Grid mat:** tools on a cutting mat. Enter the size of the *smallest* grid squares, then press **Detect grid**. It places the handles and counts the squares. If detection fails, put the 4 handles on grid crossings and type how many squares are between them. The handles snap to the crossings and the fitted grid is drawn over the photo so you can check it. Common mats have 1/2-inch lines, so check the size against the inch labels.
   - **4 points:** drag the handles onto the corners of any rectangle of known size.
3. **Trace:** the Trace view shows each traced shape in yellow, with its size.
   - Shadows or grid lines get traced: raise **Sensitivity**, or lower **Brightness weight**.
   - Shiny or pale parts are missed: lower **Sensitivity**.
   - Tools merge together: lower **Bridge gaps**.
   - On a mat, **Remove thin lines** wipes out the grid. Leave it at 0 on paper, because it also blunts sharp tips.
4. **Fix up** with the brushes above the Trace view: **Brush keep / Brush erase (B / E)** add or remove exactly what you paint (e.g. the mat between snip handles). **[ ]** change the brush size, **Ctrl+Z / Ctrl+Y** undo and redo.
5. **Shapes:** every traced shape becomes an outline made of **nodes**: square = corner (sharp), round = smooth (the outline curves through it).
   - The **Shapes** list shows every shape. To leave one out, untick it, or select it and press **Delete** (or the **Exclude shape** button). Press it again to bring the shape back.
   - **Symmetric:** for a symmetric tool, tick this on the selected shape. The mirror axis is found automatically (pink line). The two halves are averaged, so small differences from the photo even out, and the nodes are mirrored, so the outline is exactly symmetric. A node you edit is mirrored to the other side when you let go.
   - Click a shape (**Select** tool, **V**) to select it and show its nodes.
   - **Edit the nodes:**
     - Drag a node to move it.
     - Click the outline to add a node.
     - Double-click a node (or **C**) to switch it between corner and smooth.
     - **L** makes the segment after the selected node an exact straight line.
     - **Delete** removes the selected node. With no node selected, it excludes the shape.
   - **Own outline settings** gives the selected shape its own Smooth / Snap / Corner / Node detail, without touching the others. **Re-fit nodes** throws away hand edits.
   - Hand edits and per-shape settings survive re-tracing (changing Sensitivity, brush fixes, etc.).
   - **Outline settings for all shapes** (in the Shapes section) are the defaults:
     - **Keep corners sharper than:** which bends count as corners.
     - **Smooth noise:** ignores small bites and bumps (glare, mat lines) between corners, and curves keep their curvature. 4 mm suits most tools.
     - **Snap straight edges:** straight runs become exact lines; gentle curves stay curves.
     - **Node detail:** how far the outline may stray from the trace before another node is added. Lower means more nodes.
6. **Save outlines:** give them a name and a default pocket depth, then **Add to library** (or press Enter). Every ticked shape becomes its own library entry.

Press **?** (or **Shortcuts** above the picture) for every keyboard shortcut.

## 2. Layout: shapes → bin
- **Add** a library shape to put it in the bin.
- Drag it to move it, and drag the round handle to rotate (hold Shift to snap to 15°).
- Keys: arrow keys nudge it (Shift for bigger steps), R rotates 90°, Ctrl+D duplicates, Delete removes it, Ctrl+Z / Ctrl+Y undo and redo.
- **Selected** panel: pocket depth, exact rotation, Straighten (smallest box), Flip (tool lying the other side up), Duplicate, Remove.
- **Finger notches:** pick **Notch** (N) above the picture. **Shape** is a circle, or a **slot** (a rounded oblong, better for gripping long tools) that lies along the tool's edge where it snaps; set its **Slot length**.
  - A dashed circle previews where the notch will go. Near a tool it snaps onto the tool's outline (hold **Alt** to place it freely).
  - A snapped notch belongs to that tool: it moves, rotates and flips with it, and is never deeper than the tool's pocket.
  - If the tool has a symmetry axis (from **Symmetric** in Capture, or **Add symmetry axis** in the Selected panel), a mirrored twin is added on the other side. Untick **Mirror across the tool's symmetry axis** to place single notches.
  - Click a notch to remove it (and its twin). Drag notches in Select mode; a twin follows.
  - The bin grows to fit notches near its edge.
- **Bin:** **Clearance** is the gap around every tool (1 mm is a good start), and **Min wall** is the minimum material left at the bin edge. With **Fit bin to the tools automatically** on, the bin size follows the tools. Turn it off to set the units yourself.
- The library and layout are saved in your browser automatically. Use **Save project / Open project** (top right) to back them up or move them to another computer.

## 3. Generate: bin → STL
- **Height** comes from the deepest pocket plus the **Min floor**, or set it yourself.
- **Pocket edge chamfer:** a 45° bevel around the top of every pocket so tools drop in easily (default 1 mm; 0 turns it off). It's printed as ~0.2 mm steps and is always kept shallower than the shallowest pocket.
- **Max units per print:** 6 fits a 256 mm bed. Wider bins are split at grid lines into pieces; each piece is a normal bin and the pocket runs across the join.
- **Generate model** builds the mesh, checks that every body is closed, and shows a 3D preview (drag to turn, scroll to zoom).
- **Download** one STL per piece, plus a 1:1 SVG of the pocket outlines (e.g. for laser-cut foam).

## What the bins are
- Standard Gridfinity: 42 mm grid, 41.5 mm bins, 7 mm height units, and the standard 0.8 / 1.8 / 2.15 mm base profile on every cell.
- Pockets have straight walls with a chamfered top edge. Each tool can have its own depth, and where pockets overlap the deeper one wins.
- No stacking lip and no magnet holes (yet). The top is flat.
- Each STL is several overlapping closed bodies (feet, base, one layer per pocket depth). Slicers merge them when slicing.

## Accuracy tips
- Shoot straight down from high up with 2–3× zoom. Close wide-angle shots make tall parts look bigger.
- Even light and no hard shadows. Spread tools out so they don't touch.
- Print a test slice first: 1 height unit with shallow pockets. Raise **Clearance** if a tool is tight.

## Files
- `index.html`: the page and its styles.
- `js/vision.js`: perspective correction, tracing, distance transforms, contours, outline smoothing.
- `js/grid.js`: cutting-mat grid detection and fitting.
- `js/gridfinity.js`: pocket fields, bin geometry, mesh, STL/SVG export.
- `js/preview3d.js`: 3D preview (software z-buffer).
- `js/earcut.js`: polygon triangulation (port of mapbox/earcut, ISC license).
- `js/app.js`: the UI.

## License
MIT (see `LICENSE`). `js/earcut.js` is a port of mapbox/earcut (ISC).
