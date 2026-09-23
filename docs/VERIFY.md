# Verification

The reference is measured. The build is measured by the same code (`src/page/ct.js`). 1:1 means the numbers match.

## The gate

```bash
clonethis verify http://localhost:3777/<route> reference/<name>
```

The build marks its component root with `data-clone-root` (or pass `--select`). Per captured width:

| check | rule | why |
|---|---|---|
| root | width pinned to the reference (height too when the reference's height came from its container); height equal within `--tol` (0.5px) | the component owns its height, not its width |
| text runs | every painted text run of the reference has a run with the same text in the build within `--text-tol` (1px) on x, y, w, h, same line count | glyph boxes catch font, size, weight, line height, tracking, wrapping and position at once, whatever elements wrap the text |
| media | img / svg / video / canvas / iframe boxes in order per kind within 1px | images and icons are where the box model usually drifts |
| pixels | component shot vs `capture/<vp>/component.png`, % of pixels off by > 32/255 on any channel, video / canvas / iframe masked; gate `--max-diff` (3%) | colors, borders, shadows, radii, gradients: what boxes cannot see |
| console | zero errors while loading and scrolling | |
| blackout | `clonethis blackout <project>` clean | the clone never names its origin |

`--no-pin` measures the component where the page puts it (placement check). `--max-diff off` reports pixels without gating (a component with a live video or a ticker). Exit 1 on FAIL; numbers in `reference/<name>/build/verify.json`; diff sheets (build | reference | mask) in `build/diff/<vp>.png`.

### Image references (`grab-image`)

No DOM behind them, so the checks change: the **visible** size (the build's border box plus its outline, the width pinned so it comes out at the screenshot's; tolerance 1px for the px / dsf rounding), every OCR'd line present in the build's text (80% of its character bigrams, so a misread glyph or a price merged with its unit still counts), and pixels under 6% (`--max-diff`). No media, states or motion checks. `compare` lists each OCR line with where your matching text run sits relative to its ink box (a few px apart is normal: ink box vs line box).

## Finding the last pixel

1. `clonethis compare <url> <ref> --w <width>`: every reference text run next to yours with `dx dy dw dh`, line count, and the font / color when they differ. Rows are in reference order, so the first off row is usually the cause and the rest are knock-on: fix top-down.
   - `dh` on one run with the same font: line height. `dw` with the same font string: letter spacing, font weight not loading (check the network tab: a 404 font falls back silently), or a different font file.
   - every run below some y shifted by the same `dy`: a padding / gap / margin / image height above it. `clonethis boxes <url> <w> --ref <ref>` vs `clonethis refboxes <ref> <vp>` at that y shows which box.
   - `lines 2->3`: the text box is narrower than the reference (padding, max-width, a flex basis).
2. `clonethis cssq <ref> @cN` prints every rule that styles element `cN` (ids from `spec/component.txt`), per breakpoint and state.
3. Visual: `clonethis shot <url> out.png --ref <ref> --w <w>` and Read it next to `capture/<vp>/component.png`, or open the diff sheet.
4. Fix, re-run `compare`, then `verify`.

## States

`clonethis states <url> <ref>` runs the same states pass on the build: targets paired by kind + text, then per state the properties that changed on the target in the reference but not the build (and vice versa), the transition string on each side, and the pixel diff of the two state shots. Match the transition exactly: property list, duration, timing function, delay.

## Motion

Values come from source; frames check timing.

- Entrance: `clonethis frames <url> out/enter --scenario enter --ref <ref>` scrolls your component in from below the fold exactly like the capture did (`--scenario load` when it is above the fold). `clonethis sheet out/enter a.png --step 150` and the same on `reference/<name>/capture/frames/enter`: things must arrive in the same order in the same windows.
- Hover / toggle: `--scenario hover|toggle --target N` (N = the index in `motion/states.md`), compare with `capture/frames/hover-NN-*` / `toggle-NN-*`.
- Loops: `--scenario loop`; `capture/frames/report.json` has the reference verdict (PAUSES / SLOWS / no change on hover). Match it.
- `motion/animations.json` lists what was running with keyframes and timing (CSS animations, transitions and WAAPI, which covers motion / Framer appears). Those are the values.

## Before calling it done

```bash
bunx tsc --noEmit            # when TypeScript
bun run build                # or the project's build
clonethis verify http://localhost:3777/<route> reference/<name>
clonethis states http://localhost:3777/<route> reference/<name>
clonethis blackout .
```

Report the verify table. Say what was frame-checked, what was only box-checked, what was not checked, which assets are placeholders. Name the component by its role and the brand, never the source.
