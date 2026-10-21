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
4. **Fix up** with the tools above the picture:
   - **Pick:** click a shape to leave it out (grey); click it again to bring it back.
   - **Erase / Add:** paint away areas (e.g. between snip handles) or paint in missed parts. Set the **Brush size** first.
   - **Smooth outline** and **Straighten** clean up wobbly edges. Too much rounds off sharp tips.
5. **Save outlines:** give them a name and a default pocket depth, then **Add to library**. Every traced shape becomes its own library entry.

## 2. Layout: shapes → bin
- **Add** a library shape to put it in the bin.
- Drag it to move it, and drag the round handle to rotate (hold Shift to snap to 15°).
- Keys: arrow keys nudge it (Shift for bigger steps), R rotates 90°, Delete removes it.
- **Selected** panel: pocket depth, exact rotation, Straighten (smallest box), Flip (tool lying the other side up), Duplicate, Remove.
- **Finger notches:** pick **Notch** above the picture and click to add one. Click a notch again to remove it. Each notch has its own diameter and depth.
- **Bin:** **Clearance** is the gap around every tool (1 mm is a good start), and **Min wall** is the minimum material left at the bin edge. With **Fit bin to the tools automatically** on, the bin size follows the tools. Turn it off to set the units yourself.
- The library and layout are saved in your browser automatically. Use **Save project / Open project** (top right) to back them up or move them to another computer.

## 3. Generate: bin → STL
- **Height** comes from the deepest pocket plus the **Min floor**, or set it yourself.
- **Max units per print:** 6 fits a 256 mm bed. Wider bins are split at grid lines into pieces; each piece is a normal bin and the pocket runs across the join.
- **Generate model** builds the mesh, checks that every body is closed, and shows a 3D preview (drag to turn, scroll to zoom).
- **Download** one STL per piece, plus a 1:1 SVG of the pocket outlines (e.g. for laser-cut foam).

## What the bins are
- Standard Gridfinity: 42 mm grid, 41.5 mm bins, 7 mm height units, and the standard 0.8 / 1.8 / 2.15 mm base profile on every cell.
- Pockets have straight walls. Each tool can have its own depth, and where pockets overlap the deeper one wins.
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
