# ToolTrace: session notes

## Status
- Now a Gridfinity drawer suite: **Drawer → Baseplate → Bins → Make**, with Capture / Layout / Generate as the steps for one tool bin. One project = one drawer (size, baseplate, bins, tool library, checklist).
- Drawer: inside W × D × H, baseplate type (printed / laser / none), grid and tallest-bin info.
- Baseplate: ultralight printed pieces (pad or gap, even or one corner, max print size, min rows), laser sheet DXF, test piece and hole-size test strip. Cross-section matches the user's reference 3MF.
- Bins: grid editor (drag to add, move, resize, fill empty cells), standard bins with compartments / label tab / scoop / stacking lip (`js/bins.js`), tool bins that open the tool steps. Overlap, outside-grid, too-tall and empty-tool-bin warnings.
- Make: build list with counts and checklist, Bambu 3MF with plates, STL zip, laser DXF. 3MF and zip checked structurally in the browser (all XML parses, every reference resolves); **not yet opened in Bambu Studio**.
- Tool tracing as before: node outlines, symmetry, brushes, notches, chamfer, work area. Tutorial covers the drawer flow, then the tool-bin steps with the sample photo.
- Own repo (MIT) with a GitHub remote (`justinsprangers/ToolTrace`); suite commits not pushed.

## Next steps
- Open a Make 3MF in Bambu Studio; check plates, positions and that objects load. If not, the STL zip is the fallback.
- Print the baseplate test piece and a standard bin with lip; check fit and stacking. Test-cut the laser hole strip.
- Not built yet: magnet/screw holes, bins spanning baseplate joins check, multiple drawers per project, bin labels text.
- Improve auto grid detection on far shots (photos 1 and 4 in `test-photos/`).

## Decisions & gotchas
- See `CLAUDE.md` for architecture rules (project model, tool-bin sync, Make/3MF format), rejected approaches and testing tricks.
- Bambu plate grid in a 3MF: ceil(√n) columns, 1.2 × bed apart, rows toward −y (from the user's reference project). Bed size = Max print size.
- Bins stand on the drawer floor on the ultralight plate (its bottom lip is gone), so bin top ≈ units × 7 (+ 4.4 lip).
- The user's previous session was very long (1,400+ messages). Compact early.

## Log
- 2026-10-29: Tutorial sample shapes never persist; tool bins left empty by them are removed. Pushed the suite to GitHub.
- 2026-10-29: Recovered the user's 4 tools (from Edge storage of the github.io copy) into Downloads/tooltrace-recovered-tools.json. Storage is per origin: file:// and github.io copies don't share data.
- 2026-10-29: Suite: Drawer tab and project model, standard bins + lip, Bins editor, Make tab (3MF, zip, checklist), docs and tutorial
- 2026-10-29: Baseplate: test piece (2x2 corner STL) and laser hole-size test strip
- 2026-10-27: Baseplate: laser-cut DXF of the whole area (hole per cell, kerf)
- 2026-10-26: Baseplate tab, leftover in one corner option
- 2026-10-21: Tutorial with sample photo; tour uses only that run's tools (2cb5981)
- 2026-10-20: Symmetric outlines, editable node outlines, notches, chamfer; split into its own repo (MIT)
- 2026-10-20: v2 capture → layout → generate workflow; first version
