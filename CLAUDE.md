# CLAUDE.md: ToolTrace

Offline page: photo of a tool on paper (or a cutting-mat grid) → traced outline → Gridfinity bin STL with a matching pocket. User docs are in [README.md](README.md); keep it current when controls or output change.

## Rules
- **No build step, no dependencies, works from `file://`.** Plain `<script>` files sharing the global `TT`; no ES modules, `fetch`, or CDN libraries.
- Coordinates: photo = image px (y down); paper = mm from the reference rectangle's top-left (y down); bin = mm from the bin's top-left seen from above (y down). Meshes flip y (`H - y`) so the top view isn't mirrored.
- Everything shape-related is a signed distance field (negative = inside) sampled at 0.25 mm; outlines come from `TT.contours` (marching squares, inside on the right in y-down, on the left after the y flip). Clearance and notches are just `min`/offsets on the pocket field.
- Mesh = separate closed shells (feet, base slab, pocket layer overlapping it by 0.2 mm) in one STL. `TT.openEdges` must be 0 for every shell; `TT.buildAll()` checks this on every export.
- Gridfinity numbers live in `TT.GF` (`gridfinity.js`). Don't change them without checking the spec.

## Testing
- Serve the folder (`tooltrace` launch entry, port 8802). Test photos go in `test-photos/` (gitignored).
- In the hidden browser pane `img.decode()` can hang; load test images with `fetch` → `createImageBitmap`, set `naturalWidth/Height` on it, and call `TT.loadImage`. Drive the pipeline with `TT.app.runWarp()` / `runSegment()` / `applySelection()` instead of waiting on debounced inputs.
- Accuracy check: draw a synthetic letter sheet in perspective with a 100 × 40 mm rectangle on a canvas; it should trace to 100.0 × 40.0 mm with auto-detected corners.
- After geometry changes: `TT.buildAll().problems` must be empty, including split bins and notches, and every shell's signed volume must be positive.

## Not built yet
- Stacking lip, magnet/screw holes, stepped (multi-depth) pockets, 3D preview, combining tools from several photos into one bin, saving/loading a project.
