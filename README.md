# ToolTrace

Turn a photo of a tool into a Gridfinity bin with a pocket shaped like the tool. Works offline. Open `index.html` in a browser (double-click it); nothing to install.

## Use it

1. **Take the photo.** Put the tool on plain white paper, then shoot straight down from high up with 2–3× zoom. Use even light with no hard shadows. The whole tool must be on the paper. For tools longer than the paper, use tabloid (11 × 17 in) or poster board, or a cutting mat (see below).
2. **Photo step.** Choose the photo and pick the paper size. The app tries to find the paper corners itself. If it can't, drag the 4 orange handles onto the corners. A magnifier shows while you drag.
3. **Trace step.** The traced tool is tinted red with a yellow outline.
   - Picks up shadows or grid lines: raise **Sensitivity**, or lower **Brightness weight** to ignore shadows.
   - Misses parts of the tool (shiny metal, pale plastic): lower **Sensitivity**.
   - Two tools merge together: lower **Bridge gaps**.
   - Click a shape to leave it out (it turns grey). Click it again to bring it back.
4. **Bin step.**
   - Set **Clearance** (gap around the tool, 1 mm is a good start) and **Pocket depth**. Measure the thickest part with calipers.
   - Drag the tool to move it. Use **Auto-rotate**, **Turn 90°**, or type an angle.
   - **Auto size** picks the smallest bin with at least **Min wall** around the pocket. Untick it to set units yourself.
   - **Finger notches:** switch to "Click adds notch" and click where your fingers go.
5. **Export.** **Download STL** saves one STL per printable piece. **Download SVG outline** saves a 1:1 outline in mm (handy for laser-cut foam).

### Using a cutting mat instead of paper
Choose **Custom rectangle**, enter the size of a rectangle on the mat grid (e.g. 10 × 12 in), and drag the handles onto those 4 grid points. If the tool hangs past that rectangle, set **Extend past it** (mm).

## What the bin is
- Standard Gridfinity: 42 mm grid, 41.5 mm bins, 7 mm height units, and the standard 0.8 / 1.8 / 2.15 mm base profile on every cell.
- The pocket is a single depth with straight walls. The pocket floor is at least 1.2 mm above the base. **Auto size** adds height units for deep pockets.
- No stacking lip and no magnet holes (yet). The top is flat.
- Bins wider than **Max units per print** (default 6 = 252 mm, for a 256 mm bed) are split into pieces at grid lines. Each piece is a normal bin, and the pocket runs across the join.
- Each STL contains several overlapping closed bodies (feet, base, pocket layer). Slicers merge them when slicing. Every export runs a mesh check (all bodies closed) and reports any problem in the status bar.

## Accuracy tips
- The outline is the tool's silhouette as the camera sees it. Tall parts look bigger the closer the camera is, so shoot from far away with zoom.
- Test the fit before printing the full bin. Set height units to 1 and pocket depth to 2 mm, then print that thin slice.
- Increase **Clearance** if the tool is tight. Each 0.5 mm adds 0.5 mm all round.

## Files
- `index.html`: page and styles.
- `js/vision.js`: perspective correction, tracing, distance transforms, contours.
- `js/gridfinity.js`: bin geometry, mesh, STL/SVG export.
- `js/earcut.js`: polygon triangulation (port of mapbox/earcut, ISC license).
- `js/app.js`: the UI.
