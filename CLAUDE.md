# CLAUDE.md: ToolTrace

Offline page: photos of tools → traced outlines (library) → Gridfinity bin layout → STL. User docs are in [README.md](README.md); keep it current when controls or output change.

## Rules
- **No build step, no dependencies, works from `file://`.** Plain `<script>` files sharing the global `TT`; no ES modules, `fetch`, or CDN libraries.
- Three phases, kept separate: Capture (`S.*` in app.js, per photo, not saved) produces shapes; the library (`S.lib`) and layout (`L`) are saved to localStorage (`tooltrace.v2`) and project files. Don't put photo data in the library.
- Coordinates: photo = image px (y down); paper = mm (y down); library shapes = mm centred on their centroid (y down); layout = mm from the bin's top-left seen from above (y down). Meshes flip y (`H - y`) so the top view isn't mirrored.
- Capture pipeline stages (`runFrom`): warp → score → seg → edit → extract; each stage reuses the cached result of the one before. Brush strokes and picked-out shapes are stored as paper-mm points so they survive re-tracing.
- Pockets: `TT.pocketFields` rasterises items (clearance = round-joined canvas stroke) and notches per depth level into signed distance fields; `TT.pieceMesh` = feet + base slab + one prism layer per depth (bin outline minus every pocket at least that deep). Contours come from `TT.contours` (marching squares, inside on the right in y-down).
- Flip is applied in app.js (`placed`, `layoutForGeometry`) before geometry; gridfinity.js never sees `flip`.
- Gridfinity numbers live in `TT.GF` (`gridfinity.js`). Don't change them without checking the spec.

## Grid detection (`grid.js`)
- Auto: spacing from autocorrelation in many thin strips (median), crossings = local maxima of min(horizontal, vertical line response), lattice grown from strong seeds with local lattice vectors; candidate spacings est, est/2, est/3 are scored by count × median strength and must fit a homography within 0.15 cell.
- Works on the user's photos 2 and 3 (fit error ~0.5–1 mm); fails on far shots with fine 1/2-in lines (photos 1, 4) because a missing crossing column stops the growth. Things tried and dropped: Hough lines (clutter), jumping over missing crossings and model-based growth (both mislabel).
- Manual fallback `TT.refineGrid`: handles on 4 crossings + square counts → labels every crossing inside by rounding through the homography, refits. Reliable.

## Testing
- Serve the folder (`tooltrace` launch entry, port 8802). Test photos go in `test-photos/` (gitignored); the user's mat has 1/2-in grid squares.
- In the hidden browser pane `img.decode()` can hang; load test images with `fetch` → `createImageBitmap` and call `TT.loadImage(bitmap, name)`. Drive things through `TT.app` (`runFrom`, `addItem`, `generate`, `S`, `L`, `C`).
- Accuracy: a synthetic letter sheet in perspective with a 100 × 40 mm rectangle traces to 100.0 × 40.0 mm in Paper mode.
- After geometry changes, Generate must report "Mesh check passed" (every shell closed, positive volume) for split bins, multiple depths and notches.

## Repo
- This folder is its own git repo (branch `main`, MIT), ignored by the parent `C:\Claude` repo; history before the split came from there via `git subtree split`. No remote yet: don't push or publish unless the user asks. Never commit `test-photos/` or anything from the private `C:\Claude` repo.

## Not built yet
- Stacking lip, magnet/screw holes, editing outline vertices directly, auto-arrange.
