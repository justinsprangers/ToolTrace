# CLAUDE.md: ToolTrace

Offline page: photos of tools → traced outlines (library) → Gridfinity bin layout → STL. User docs are in [README.md](README.md); keep it current when controls or output change.

## Rules
- **No build step, no dependencies, works from `file://`.** Plain `<script>` files sharing the global `TT`; no ES modules, `fetch`, or CDN libraries.
- Three phases, kept separate: Capture (`S.*` in app.js, per photo, not saved) produces shapes; the library (`S.lib`) and layout (`L`) are saved to localStorage (`tooltrace.v2`) and project files. Don't put photo data in the library.
- Coordinates: photo = image px (y down); paper = mm (y down); library shapes = mm centred on their centroid (y down); layout = mm from the bin's top-left seen from above (y down). Meshes flip y (`H - y`) so the top view isn't mirrored.
- Capture pipeline stages (`runFrom`): warp → score → seg → edit → extract; each stage reuses the cached result of the one before. Fix strokes and picked-out shapes are stored as paper-mm points so they survive re-tracing.
- Fix tools: Brush keep / erase only (keys B/E, LaserEngraver colours, brush size in screen px, `[`/`]`, Ctrl+Z/Y). Smart keep/remove were removed at the user's request (node editing made them redundant).
- Symmetry: `TT.findAxis` (reflection overlap search), `TT.symmetrize` (mean of the shape's and its mirror's signed distance fields), `TT.mirrorNodes` (keep one side, mirror the rest; near-axis nodes snap onto it). Stored as `edit.sym` {p, a, score}; library shapes keep `axis` in shape coordinates.
- Chamfer (`L.chamfer`): `TT.pieceMesh` splits the top layer into ~0.2 mm steps, each with the all-pockets field offset by its height above the chamfer start (45°); capped below the shallowest pocket minus 0.6 mm.
- Notch shapes: `len > d` = slot (stadium drawn as a round-capped line of width d, `TT.notchPath` / `TT.notchDist`); `ang` follows the outline tangent at the snap point; mirrored twins get `2·axis.a − ang`.
- Notches: {id, x, y, d, len, ang, depth, item, pair}. With `item` set, x/y are in that tool's shape coordinates (so they follow move/rotate/flip), depth is capped at the tool's, and `pair` links mirrored twins. `notchesWorld()` converts for geometry. Adding a notch refits the bin.
- UI conventions: side-panel sections are `<details class="sec" data-key>` (open state saved in localStorage `tooltrace.sections`); help is a short `ul.tips` plus `details.more` for the rest, keep it that way rather than paragraphs. `ctl()` draws a default tick and ↺ reset; `[data-reset=containerId]` buttons reset every ctl created in that container.
- Work area (`S.area`, optional green handles): `reference()` maps it into paper mm, the warp covers its bounding box and pixels outside the polygon get alpha 0 (treated as off-photo). Replaced the old "Extend past reference" slider.
- Shape names: `edit.name` (typed in "Name the selected shape"); "Add all" uses prefix + `shapeLabel`. Library deletes are one-level undoable from the status bar (`deleteLib`).
- Layout click order: notches before tools (snapped notches overlap the tool edge). `S.selNotch` + Delete removes a notch and its twin.
- Tutorial (`js/tour.js`): `STEPS` = {target selector, title, html (short bullets), phase, before()}; a dim layer with a clip-path hole + blue ring spotlights the target, a card sits beside it. Auto-starts once (localStorage `tooltrace.tourDone`), **Tutorial** button replays. `TT.samplePhoto()` draws a wrench and screwdriver on letter paper (traces to ~40 × 204 and ~31 × 215 mm). The tour works on its own bin (`tourBin`): only library shapes added during this run, never the user's existing work; at the end `TT.app.restore` puts the user's layout back and removes the sample shapes (shapes from their own photo stay). When controls or sections change, update the matching steps. Don't use a huge box-shadow for the dimming; it didn't render in testing.
- The page must not scroll: body is a flex column with overflow hidden; the canvas is `flex: 1 1 0; height: 0` so its pixel size can't push the layout.
- The browser pane caches scripts: after editing JS, re-fetch them with `cache: 'reload'` before reloading, or you test stale code.
- Post-processing is vector editing (user's direction): `TT.traceShapes` gives raw sub-pixel loops; `TT.fitNodes` turns each into nodes {x, y, c (corner), s (straight segment to next)}; `TT.nodePath` draws them as cubic Hermite segments (Catmull-Rom tangents at smooth nodes, chord tangents at corners, straight segments linear and their smooth neighbours tangent to them). Library shapes are the sampled node paths.
- Per-shape edits live in `S.edits` ({at, off, set, nodes}) and are matched to shapes after any re-trace by the point `at` (inside the shape). Hand-edited `nodes` win over `set`, which wins over the global settings. Capture selection is `S.cSel`; `S.sel` is the Layout selection.
- Outline cleanup (`TT.cleanLoop`, used by fitNodes), user requirement: reduce noise without compromising the real shape. Edges are sub-pixel (sign from the mask, magnitude from the colour score). Corners must turn > threshold over ~4 mm and > 0.75 × threshold over ~8 mm (rejects bites); stretches between pinned corners get a robust local quadratic fit (bisquare, so one-sided bites are ignored and curves don't shrink); straight snapping skips runs that bow one way. Plain Gaussian smoothing and Douglas-Peucker "straighten" were tried first and rejected by the user (rounded corners / faceted arcs). Synthetic check: rectangle, triangle and disc trace within ~0.2 mm with sharp corners.
- Keyboard: one `keydown` dispatcher in app.js, scoped by phase; keep the Shortcuts dialog (`#keys` in index.html) in sync. Layout undo = JSON snapshots after each `layoutChanged`; Capture undo = snapshots of the fix lists before each edit.
- Pockets: `TT.pocketFields` rasterises items (clearance = round-joined canvas stroke) and notches per depth level into signed distance fields; `TT.pieceMesh` = feet + base slab + one prism layer per depth (bin outline minus every pocket at least that deep). Contours come from `TT.contours` (marching squares, inside on the right in y-down).
- Flip is applied in app.js (`placed`, `layoutForGeometry`) before geometry; gridfinity.js never sees `flip`.
- Gridfinity numbers live in `TT.GF` (`gridfinity.js`). Don't change them without checking the spec.
- Baseplate tab (`js/baseplate.js`, `TT.BP`): independent of the bin workflow; settings in localStorage `tooltrace.baseplate` (not in project files). The cell profile was measured from the user's reference 3MF (Sparky's "Lightest Gridfinity Base", 0.4 nozzle): 4.25 tall, inner face 2.15 in to z 2.5 then 45° to a 0.4 top, 0.82 wall, open hollow under the slope, outer wall 0.82, holes where cells meet. Each cell is the profile swept around its r4 square; cells, outer wall, padding strips and ribs are separate overlapping closed shells. `TT.bpPlan` splits each axis into the fewest pieces ≤ max print (padding counts), each ≥ min rows (relaxed with a warning), extra cells to the middle pieces; types merge 90° rotations, not mirrors. 3D view shares the orbit/zoom code via `in3d()` / `shown3d()` in app.js.

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
