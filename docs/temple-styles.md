# Sculpted temple styles

The frame-style selection now changes the physical temple solids as well as the front silhouette:

| Style | Temple geometry |
| --- | --- |
| Classic | Slim tapered shaft, chamfered edges and a softly dropped end |
| Bold | Broad 9 mm arm with deeper 1 mm bevels and a tapered tip |
| Brow | Raised 8.5 mm architectural shoulder, distinct step and slimmer tip |

Arms are lofted closed octagonal cross-sections, not textured rectangular bars. The shared fork and connector blocks also have actual chamfers. Logo engraving retains its flat outward stock, 0.4 mm depth and original location. The arm tapers inward so its outward face still provides build-plate contact. Existing lens openings, seats, fastener positions and hinge axis are unchanged.

Preview and exported STL share these solids. `templeStyle`/`templeProfile` identify them in preview JSON; `temple_style`/`temple_profile` identify them in the ZIP README. The viewer offers 3D, Front, Side and Parts; Side persists when switching styles. Use `?view=side` to open a direct comparison. Raking illumination reveals actual bevels without altering geometry.

Validation: 29 CAD tests passed, including all frame and branding tests plus new temple tests over both sides, all three styles and 90/125/180 mm lengths. Tests check positive watertight solids, engraving envelope, mirrored geometry, distinct section silhouettes, real sloped bevel faces, clear hinge bores/fork gaps, assembly collisions, STL/preview agreement and print-bed contact/packing. No physical printing or wearer comfort validation is implied.
