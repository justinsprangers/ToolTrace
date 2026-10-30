# ToolTrace: session notes

## Status
- Full workflow works: Capture (photo → traced outline, paper or cutting-mat scale) → Library → Layout → Generate (Gridfinity bin STL with pockets).
- Node-based outline editing, symmetry, brush keep/erase fixes, notches and slots, pocket edge chamfer, work area, multi-delete, and save options are all done.
- Guided tutorial with a built-in sample photo. It uses its own temporary bin and restores the user's layout afterward (verified 2026-10-21).
- Auto grid detection works on close mat photos but fails on far shots with fine 1/2-in lines. Manual 4-point grid is the reliable fallback.
- Baseplate tab (2026-10-26): ultralight Gridfinity baseplate for an area, pad-to-fill or leave gap, split by max print size and min rows, STL per distinct piece. Cross-section matches the reference 3MF; mesh check passes. Not printed yet.
- Own repo with a GitHub remote (`justinsprangers/ToolTrace`); everything is pushed as of 2026-10-21.

## Next steps
- Not built yet: stacking lip, magnet/screw holes, auto-arrange.
- Improve auto grid detection on far shots (photos 1 and 4 in `test-photos/`).
- Print a test bin to verify pocket clearance and Gridfinity fit on real hardware.
- Print a baseplate piece (padded corner) and check bin fit, the padding frame, and Bambu's slicing of the overlapping shells.
- Test-cut a small laser baseplate (e.g. 2 × 2) to check the 37.5 mm hole fit; DXF not yet opened in LightBurn.

## Decisions & gotchas
- See `CLAUDE.md` for architecture rules, rejected approaches, and testing tricks.
- The user's previous session was very long (1,400+ messages). Compact early.

## Log
- 2026-10-29: Baseplate: test piece (2x2 corner STL) and laser hole-size test strip
- 2026-10-27: Baseplate: laser-cut DXF of the whole area (hole per cell, kerf)
- 2026-10-26: Baseplate: leftover split evenly or all in one corner (more standard pieces)
- 2026-10-26: Baseplate tab (ultralight Gridfinity baseplate generator)
- 2026-10-21: Tutorial with sample photo; tour uses only that run's tools (2cb5981)
- 2026-10-21: Slot notches, pocket chamfer, cleaner panel, work area, library multi-delete
- 2026-10-20: Symmetric outlines, editable node outlines, smart tools dropped
- 2026-10-20: Split into its own repo (MIT)
- 2026-10-20: v2 capture → layout → generate workflow; first version
