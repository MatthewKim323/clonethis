# The method

Same idea as 1to1, applied to one element subtree: replace guessing with measurement, then define done as numbers matching.

## 0. Rule zero: the clone never says where it came from

The component becomes the user's own. Nothing in the project names its origin, and that is enforced:

- reference dirs are named by role (`--as pricing-card`), never by host
- assets are content addressed by their bytes (`img-<sha1>.webp`, `font-<sha1>.woff2`); origin filenames are dropped
- everything written into the reference is scrubbed after urls are localized: origin words become the project's brand (`--brand`, default the project folder name), absolute links back to the origin become route-relative
- the source url, page title and source selector live in `reference/<name>/.origin.json` and nowhere else; `clonethis init` gitignores it; `clonethis origin <ref> --url|--selector` feeds rigs
- `clonethis blackout <project>` scans the project (skipping `reference/`) and `clonethis verify` fails on a hit

The tool cannot scrub pixels: a logo or wordmark inside the component still shows the origin. Treat it as a placeholder and say so.

## 1. What 1:1 means for a component

A component does not own its width: the grid track, the container, the flex row it sits in decide it. It does own everything inside. So 1:1 is defined with the root's width pinned to the reference's (and its height too when the reference's height came from its container: stretch, flex grow, grid row):

- the root's height matches at every width
- every painted text run (the glyph box of each text node, relative to the root) matches in x, y, w, h within 1px with the same number of lines. One check covers font family, size, weight, line height, letter spacing, wrapping and position, and it does not care how the build wraps its text in elements
- every img / svg / video / canvas box matches within 1px
- the pixel diff of the component shot is under 3% (antialiasing and a mid-loop badge make it non-zero)
- zero console errors; blackout clean
- states match: hover / press / focus / open change the same properties with the same transitions
- motion values come from source, timing checked frame by frame

## 2. Extract the truth (`clonethis grab`)

1. **Resolve once, re-find everywhere.** The first pass (headed) resolves `--select / --text / --name` to one element, outlines it, and derives a canonical locator. Every width loads a fresh page and re-finds it among the visible matches.
2. **Revealed and at rest.** Each width loads the page, runs the reveal pass (scroll to the bottom and back, wheel-driven under smooth scroll libraries) so scroll-triggered entrances have played, then scrolls the component to the viewport center and waits for images and fonts.
3. **Exactly the component.** `component.png` is the root's border box at 2x cut out of real viewport screenshots (scroll-and-stitch when taller than the viewport; never captureBeyondViewport, which re-lays-out vh units). Fixed / sticky elements that are not the component are hidden while shooting.
4. **Boxes, not pixels.** `layout.json`: every element in the subtree with its rect relative to the root and the computed styles that decide layout and paint, plus `::before` / `::after`. `texts.json`: the painted text runs. `media.json`. `context.json`: the type it inherits, the backdrop behind it, its ancestor chain (tags, classes, data attributes), whether its height came from its container.
5. **Every rule that styles it.** Every stylesheet on the page is read (CSSOM for same-origin and inline, fetched text for cross-origin, adopted sheets included) and parsed into rules with their at-rule context. Each selector is reduced to what a static DOM can test (`.card:hover .title::after` -> `.card .title`), prefiltered on its rightmost compound, then matched against the subtree in the page at every width. Because matching ignores media conditions, the rules for every breakpoint and every state come along, including breakpoints between the captured widths. Kept in cascade order with the @font-face, @keyframes and @property they use: `css/used.css`, `css/rules.json` (with which element ids each matched per width), `spec/component.txt` (tree + rules split at rest / by breakpoint / by state).
6. **States, measured.** On a fresh desktop page: for every interactive element in the component, move the pointer onto it and let animations settle, snapshot every computed property of the subtree, diff against rest; press (released off the element so no click fires); keyboard focus; click toggles open and shut. Each state: the changes (element, property, from, to), the transition in effect, a shot. Loops are excluded from the diffs.
7. **Frames.** CDP screencast (every compositor frame with its swap timestamp), cropped to the component: the entrance (load if it is above the fold, otherwise scrolled in from below the fold over 1.5s on a fresh page), each hover / toggle target, and a loop recording (4s untouched, then hovered: does it pause?). Per-frame change gives a motion timeline in ms.
8. **Assets.** Everything the subtree paints with (img currentSrc per width + src, srcset entries that loaded, video / poster, css backgrounds / masks / content urls incl. pseudo elements, svg `<image>` / external `<use>`, fonts of the families it renders with) downloaded once, content addressed.
9. **Framer.** The appear animations of the component's elements (`motion/framer-appear.json`), the page modules, and a rip that prints only the module windows near the component's own layer names and scope classes, plus the transition constants.
10. **Snapshot + self-check.** `snapshot/index.html` puts the captured html (per width when it differs), the used css, fonts and assets, the inherited type and custom properties, and the ancestor chain (same tags / classes / attributes so descendant selectors still match, boxes neutralized) around a root pinned to its captured width. Then the snapshot is served and run through `verify`. A PASS proves nothing was left behind; a FAIL shows where script owns the result.

## 3. Build

`clonethis init` writes the project's CONVENTIONS.md: where the component goes for this stack, the verify page and route, the sizes to hit, the rules. The component's root carries `data-clone-root`; the verify page renders it alone on its backdrop color.

Build static layout first at 1440, then the other widths, then states, then motion. Port `css/used.css` (consistently renamed) or translate it; values stay exact. The spec's per-rule element ids make it mechanical: `clonethis cssq <ref> @c12` prints every rule that styles element 12 at every breakpoint and state.

## 4. Verify until PASS

`clonethis verify` per width; `compare` names the text run or media box that is off and by how much, with its font and color; `boxes` / `refboxes` show the element box model; `states` compares hover / press / focus / open; `frames` + `sheet` compare timing. docs/VERIFY.md has the loop.

## 5. Report honestly

The verify table per width, what states matched, what motion was frame-checked, what was not checked, which assets are placeholders. Origin-blind.
