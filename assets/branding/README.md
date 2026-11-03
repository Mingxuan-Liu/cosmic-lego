# Cosmic Lego brand mark

The selected mark is [cosmic-lego-mark.png](cosmic-lego-mark.png), a transparent
1254 × 1254 RGBA PNG. Keep the project name as editable text alongside it rather
than baking a wordmark into the bitmap.

## Design

A single gold brick represents a piece of the cosmos that can be manipulated and
understood. Teal and lavender bricks form a tilted ring around it. One detached
brick and an open connection suggest that the visualization can be extended with
another reusable piece. A small pixel star supplies the astronomical cue.

The isometric, stepped silhouette expresses the building-block idea. The central
brick was simplified from an initial cluster to improve recognition when the
mark is reduced. Indigo outlines separate the colors on both light and dark
backgrounds. The image uses pixel-art styling; it is a generated raster, not a
procedurally enforced pixel grid or an exact limited-color palette.

The ring is an artistic branding metaphor, not an orbital model or measured
astronomical image. This is an original project mark, not the LEGO company logo.
It contains no corporate lettering or engraved brand stamps and makes no claim
of affiliation, endorsement, or trademark clearance for the project name.

## Asset checks

- Visual inspection: coherent ring and central brick, no lettering, detached
  assembly piece and pixel star visible, complete silhouette inside the canvas.
- PNG alpha ranges from 0 to 255; all four corners are transparent.
- Approximately 64.2% of pixels are fully transparent. The principal visible
  artwork (alpha greater than 32) occupies x=92–1141 and y=144–1090.
- Very faint low-alpha pixels extend beyond that principal footprint, so the
  image is best placed as a full square rather than cropped using any-nonzero
  alpha bounds. It has no opaque background tile.
- Small-icon placement should be checked in the consuming interface. This full
  mark preserves more detail at medium and large sizes than at favicon size.

## Generation provenance

- Date: 2026-11-02.
- Method: built-in `image_gen` tool, first generation followed by one targeted
  edit. No CLI/API-key route was used.
- Provider/model identifier, seed, and generation cost were not exposed in the
  tool result. Exact rerendering from the prompt is not promised.
- Selected output: `exec-a37f20eb-6c0e-4596-9612-7bcdeda9e21b.png`, copied into
  this directory without raster modification. The source remains in the tool's
  generated-image store; the first draft is not part of the repository assets.
- The transparent-background option was enabled for both calls.

### Initial prompt

```text
Use case: logo-brand.
Asset type: original pixel-art brand mark for an astronomy visualization toolkit called Cosmic Lego. This is a logo symbol only: NO WORDS, NO LETTERS, NO NUMERALS.
Primary concept: assemble a miniature cosmos from reusable building bricks. A compact warm-gold celestial core is made from a small cluster of interlocking toy-like bricks with clearly stepped pixel edges and a few simple visible square-pixel studs. A single tilted orbital ring, made from six to eight substantial violet and teal brick segments, passes behind and in front of that core. One small teal brick is separated from a matching gap near the upper-right section of the ring, showing that another piece can be added. The ring and central core must read as one coherent, memorable symbol rather than a pile of disconnected blocks.
Style: carefully designed low-resolution pixel art, isometric 2:1 stepped diagonals, consistent square-pixel grid, crisp hard silhouettes, flat limited-color shading. Large simple forms, balanced negative space, recognizable at icon size. No photorealistic plastic, no smooth gradients, no glossy 3D rendering, no blur, no fine texture. A single tiny four-point pixel star may balance the open space; avoid decorative starfields.
Palette: deep indigo outlines #1C1642, warm gold #F2C063 and pale warm highlights #FFF3DC for the core, lavender #B7A8E8 and teal #70D5CD for orbital bricks, with restrained darker purple and teal shadows. Keep the mark readable on both light and dark backgrounds using its own dark outline.
Composition: centered square mark with a strong silhouette, entire symbol visible, using roughly 80–85 percent of the square canvas with modest even transparent margin. True transparent background, no background tile, no shadow cast on a background, no checkerboard drawn into the artwork. No text, captions, mockup, frame, watermark, red-square corporate logo, official LEGO lettering, or brand stamps on any studs. This must be a new independent project identity, not the LEGO company logo.
```

### Selected refinement prompt

The first generated mark was supplied as the edit target.

```text
Refine this original pixel-art astronomy building-brick brand mark. Preserve the tilted segmented teal/lavender orbit, detached teal brick, small pixel star, indigo outlines, composition, and genuinely transparent background. Change the gold center only: replace the many separate gold blocks and hanging bottom gold pieces with ONE simple, compact gold square 2-by-2 interlocking brick with four studs on its top. The central brick is the celestial core. Keep it centered within the orbit, with plenty of transparent breathing room between core and ring, and let the front ring correctly overlap its bottom edge. This should simplify the symbol and improve readability at small icon sizes. Keep the crisp stepped square-pixel art and isometric perspective. Prefer flat color areas and two shade levels, not smooth gradients or glossy realism. No lettering or brand stamps. Remove all faint stray pixels outside the intended mark; the outer margin and interior empty spaces must be truly alpha-transparent. Keep all visible mark pixels inside a modest even 10 percent outer margin. Output only the single finished logo symbol, no variants, no text, no background tile or mockup.
```
