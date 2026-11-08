# ToolTrace: session notes

## Status
- Gridfinity drawer suite: **Drawer → Baseplate → Bins → Make**, with Capture / Layout / Generate as the steps for one tool bin. One project = one drawer (size, baseplate, designs, placed bins, tool library, checklist).
- Baseplate: **Ultralight** (from the user's reference 3MF), **Standard** (full spec profile) or **Magnet** (standard on a 3 mm floor with magnet pockets); pad or gap, even or one corner, max print size, min rows; laser sheet DXF, test piece and hole-size strip. Downloads are 3MF.
- Bins: list of **bin designs** placed as copies on the grid (Place or drag, ghost, R rotates, Make unique). "+ Standard bin ▾" presets (plain, cups, screw sorter, label tray, deep, magnet, Pocket bin). Design options: compartments, labels, scoops, lip, magnets, walls, half dividers. Live 3D preview of the selected design; **Plan / 3D** view of the whole drawer.
- Layout: **Simple shapes** (rect, rounded rect, circle, slot, hexagon) as pockets, with copies laid out in a grid.
- Make: build list with counts and checklist, Bambu 3MF with plates, per-row 3MF, STL zip fallback, laser DXF. 3MF checked structurally in the browser; **not yet opened in Bambu Studio**.
- Own repo (MIT), GitHub remote `justinsprangers/ToolTrace`, served on GitHub Pages; the user pushes from GitHub Desktop.

## Next steps
- Open a Make 3MF in Bambu Studio: plates and positions. If not, the STL zip is the fallback.
- Print a magnet bin on the Magnet baseplate; check magnet hole fit (6.5 × 2.4 mm for 6 × 2 magnets).
- Not built: screw holes, lids, wall patterns/text, STEP (skipped on purpose: meshes are triangles), multiple drawers per project.
- Improve auto grid detection on far shots (photos 1 and 4 in `test-photos/`).

## Decisions & gotchas
- See `CLAUDE.md` for architecture rules (project model, designs vs placed bins, 3D, 3MF), rejected approaches and testing tricks.
- Bump `?v=` on the script tags with every JS change (GitHub Pages cache crash, 2026-10-30).
- The browser pane is usually minimized: emulate 1400×860 with resize_window (screenshots then work) or use the headless Edge harness (`test-photos/shot.html`).
- Bambu plate grid in a 3MF: ceil(√n) columns, 1.2 × bed apart, rows toward −y. Bed size = Max print size.
- Bins stand on the drawer floor on the ultralight/standard plates; the magnet plate lifts them 3 mm (`plateLift`).
- STEP export skipped: a faceted STEP from triangle meshes gives no benefit over 3MF.

## Log
- 2026-11-07: Removed the filament-color option at the user's request (not what they wanted); US spelling throughout.
- 2026-11-07: Baseplate styles (standard, magnet), bin presets, magnet holes, walls, half dividers, simple-shape pockets, live design 3D preview, drawer 3D view, 3MF downloads everywhere. Mesh checks pass for every option combination; scripted UI tests and the tutorial pass on the user's real data.
- 2026-10-30: Fixed GitHub Pages stale-script crash (`?v=`); Bins polish (toolbar, tool steps only while editing, per-tab status).
- 2026-10-30: Bin designs separate from placement (project v4), ghost placing, drag from list, rotation, Done ← Bins.
- 2026-10-29: Tutorial samples never persist; pushed the suite. Recovered the user's 4 tools from Edge storage (github.io origin).
- 2026-10-29: Suite: Drawer tab and project model, standard bins + lip, Bins editor, Make tab (3MF, zip, checklist).
- 2026-10-26–27: Baseplate tab, one-corner leftover, laser DXF, test pieces.
- 2026-10-20–21: Capture → layout → generate, node outlines, symmetry, notches, chamfer, tutorial; own repo (MIT).
