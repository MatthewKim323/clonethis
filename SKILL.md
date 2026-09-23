---
name: clonethis
version: 0.1.0
description: |
  Clone ONE component off a live website 1:1 (pixel, states and motion), not "inspired by": a pricing card, a
  navbar, a hero, a footer, a testimonial slider, a button. Same method as 1to1, scoped to a single element
  subtree: find the element, grab its measured truth at 1440/1024/810/390 (subtree boxes, painted text runs,
  every css rule that matches it across all stylesheets and breakpoints, fonts, assets, hover/press/focus/open
  diffs, 60fps frames, Framer appear + module rip), a standalone snapshot that must pass its own gate, then
  build it into the user's project and verify until `clonethis verify` says PASS at every width. Origin-blind:
  the source is never named in the clone. Input is a url + a way to name the element, a url + a SCREENSHOT of
  the component (it finds the matching element itself), or screenshots alone (no url: the image is the
  reference, gated on size, OCR'd text and pixels). Use when asked to "clone this component", "grab this
  navbar", "steal this pricing card", "rip this section", "copy this button 1:1", "clonethis", "I want that
  <thing> from <site>", "build this from the screenshot", "clone what's in this image".
triggers:
  - clone this component
  - clonethis
  - grab this component
  - copy this section 1:1
  - rip this navbar
  - steal this pricing card
  - clone just the hero
  - clone this from a screenshot
  - build this screenshot 1:1
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
  - AskUserQuestion
---

# clonethis

1to1 clones a page. clonethis clones one thing on it. Point at a component, get `reference/<name>/` (the measured truth of that subtree at every width), build it into the project, verify until `clonethis verify` says PASS at every width.

**Rule zero: origin blackout.** The clone is the user's own component. It never says where it came from: no origin name, host, brand, logo filename, link, source selector or "cloned from / like <site>" in a component, file name, class name, comment, alt text, metadata, reply or commit message. The tool enforces it: reference dirs are named by role (`--as pricing-card`), assets are content addressed (`img-<hash>.webp`), everything written is scrubbed (origin words read as the project's brand, origin links go route-relative), and the source url + source selector live only in `reference/<name>/.origin.json`, which `clonethis init` gitignores. `clonethis blackout <project>` is the scanner and `clonethis verify` fails on a hit. Do not defeat it: never paste the url or the source selector into code or docs, never copy text from a live tab, never tell a builder agent what the site is.

## Setup (idempotent)

```bash
cd ~/.claude/skills/clonethis && [ -d node_modules ] || bun install   # or npm install
export PATH="$HOME/.claude/skills/clonethis/bin:$PATH"   # or call bin/clonethis by path
clonethis help
```

Needs Node >= 22.18 (the shim runs the TypeScript CLI on Node; bun only installs). The shim installs the matching Chromium on first run.

## The flow (docs/METHOD.md has the reasoning)

### 0. Pin down what "the component" is
The user says "the pricing card" or "that navbar". Turn it into one element:

```bash
clonethis find <url> "Most popular"          # hits by text / selector / layer name, each with its ancestor chain
                                             # (size, element count, a selector that survives reloads) + find/<n>.png with the chain outlined
clonethis pick <url>                         # or: the user points at it in a real window, [ ] changes level, click takes it
```

**Got a screenshot?** When the user drops an image of the component (with or without a url):

```bash
clonethis find <url> --like shot.png          # every element that looks like it, at every width: score, visual, OCR text overlap, crops + like.png
clonethis grab <url> --like shot.png --as pricing-card     # takes the best match (warns when the top two are close)
clonethis grab-image shot.png [shot-phone.png] --as pricing-card --vp 1440,390 [--dsf 2]   # NO url: the screenshot is the reference
```

With a url, always prefer `--like` over `grab-image`: the page gives the real css, fonts, states and motion; the screenshot only says which element. `grab-image` is for when there is no page (a design export, a shot of an app, a site behind a login): the reference is the image trimmed to its visible edge, its OCR'd text lines with ink boxes (Apple Vision, macOS), its palette and its row bands (the vertical rhythm). No DOM, no css, no states, no motion: read the image, identify the font (ask when unsure), build, and verify gates on the visible size, every OCR line being present, and pixels under 6%. `--dsf` is the screenshot's pixel ratio (2 for a Mac Retina screenshot); if text looks the wrong size, that is the knob.

Read the `find/*.png` outlines. The right level is the element whose box is the component's visual edge (its background, border, shadow or padding), not the text inside it and not the section around it. When two readings are plausible (the card vs the card grid, the nav bar vs the whole header), ask the user with AskUserQuestion and show both sizes. docs/SELECT.md covers the edge cases: repeated components (`--nth`), per-breakpoint swaps, fixed navs, components inside a slider.

### 1. Lock the goal
```
/goal <templates/GOAL.md text with name, project, route filled in; never the source url or selector>
```
The condition is objective: `clonethis verify` PASS at every captured width, states matching, typecheck + build green.

### 2. Grab it
```bash
cd <project>
clonethis grab <url> --select "<selector from find>" [--nth N] --as pricing-card --brand Aurora
#   or --text "Most popular" --up 3,  or --name "<Framer layer>"
```
Headed first pass so the user sees which element it took (outlined red), then headless at 1440 / 1024 / 810 / 390. Produces `reference/<name>/`: `spec/component.txt` (tree + every rule that applies, at rest / per breakpoint / per state, with the element ids each matched), `css/used.css`, `dom/component.html` (+ per width when the page swaps subtrees), `capture/<vp>/{component.png, context.png, layout.json, texts.json, media.json, context.json}`, `capture/states/` + `motion/states.md`, `capture/frames/` + `motion/frames.md`, `motion/animations.json`, Framer extras, `assets/`, `snapshot/index.html` and `REBUILD.md`. Read `REBUILD.md` first, then Read the four `component.png` files: know what it is at every width before writing code.

The grab ends with a **snapshot self-check**: the static snapshot (captured html + used css + fonts + assets + inherited context) runs through the same gate the build will. PASS means the extraction is complete. A FAIL at some width is information: usually script-driven layout or motion the static page cannot hold (a JS-measured height, a slider transform, a canvas). REBUILD.md's table says where.

### 3. Rulebook into the project
```bash
clonethis init <project> --ref reference/<name> --port 3777
```
Writes `reference/CONVENTIONS.md` + `reference/GOAL.md`, filled for the project's stack (read off package.json: Next, Vite/React, Svelte, Vue, Astro or plain html): where the component file goes, the verify page and its route, the sizes to hit. Gitignores `.origin.json`.

### 4. Build it
Small component (one card, one button, a nav): build it yourself. Big one (a whole footer, a mega menu, a bento grid): scaffold the shell (root, grid, shared tokens) yourself, then one agent per part with `templates/prompts/part-builder.md`, and one motion-ripper agent (`templates/prompts/motion-ripper.md`) in parallel when the component has non-trivial motion. docs/AGENTS.md has the split rules.

The component's root element carries `data-clone-root`. The verify page renders only the component on the backdrop color from `context.json`. Port `css/used.css` (rename classes consistently) or translate it into the project's styling; either way every value is exact. Fonts from `assets/fonts/` with the `@font-face` from `used.css`: a fallback font fails verify because the glyph boxes move.

### 5. Verify until PASS (docs/VERIFY.md)
```bash
clonethis verify http://localhost:3777/<route> reference/<name>        # per width: root, text runs, media, pixels, console, blackout
clonethis compare http://localhost:3777/<route> reference/<name> --w 1440   # every text run and media box, yours vs reference, dx dy dw dh + font / color
clonethis boxes http://localhost:3777/<route> 1440 --ref reference/<name>   vs   clonethis refboxes reference/<name> desktop
clonethis shot http://localhost:3777/<route> out.png --ref reference/<name> --w 390     # Read it next to capture/mobile/component.png
clonethis states http://localhost:3777/<route> reference/<name>        # hover / press / focus / open vs the reference, with pixel diffs
clonethis frames http://localhost:3777/<route> out/enter --scenario enter --ref reference/<name> && clonethis sheet out/enter a.png && clonethis sheet reference/<name>/capture/frames/enter b.png
clonethis blackout .
```
Verify pins the component's width (and its height, when the reference's height came from its container) to the reference, because the component's width belongs to where it sits, not to the component. `--no-pin` also checks placement. A text run off by 1px is not "close enough": `compare` names it, its font and its color; fix the box model and re-measure.

### 6. Ship
Typecheck, build, `clonethis verify` PASS table for every width, `clonethis states` matching, `clonethis blackout .` CLEAN. Report honestly in origin-blind terms: what matches, what does not, what was not checked (motion only frame-checked, a canvas left static), placeholder logos.

### 7. Harvest (optional)
A clean, verified component is design-vault material. If the design-vault skill is installed: `/Volumes/Vault/dev/design/vault/bin/vault ingest <project>` and follow its growth loop.

## Behaviours

- Headed browser only for the target-resolving first pass (`--headless` skips it); every width and every rig runs headless.
- Widths: 1440 / 1024 / 810 / 390 by default (Framer's breakpoints, tablet at both edges); `--viewports` changes them. A width where the component is not rendered is recorded as missing and skipped by verify (a desktop-only nav, a mobile-only drawer).
- States are measured, not guessed: the pointer moves onto every interactive element, presses (released off it so nothing fires), keyboard-focuses, clicks toggles open and shut. Properties an infinite loop keeps moving are ignored in the diffs.
- Motion values come from source (animations.json keyframes and timing, states.md transitions, the Framer rip), never from eyeballing frames. Frames verify timing.
- Links are never followed, forms never submitted, buttons never clicked unless they are toggles (aria-expanded, summary, tabs, accordions).
- One dev server on one port for the whole job. Never start a second one, and never kill a process you did not start to free a port: pick another port.
- No em dashes anywhere in generated code or docs.
- Do not grab from authenticated or paywalled pages without the user confirming they have the right to.

## Files

- `docs/METHOD.md` the method and the reasoning behind each step
- `docs/SELECT.md` choosing the element: levels, repeats, breakpoint swaps, fixed and overlaid components
- `docs/VERIFY.md` the gate, what each check means, how to find the last pixel
- `docs/AGENTS.md` when to split a component across agents, prompts, failure handling
- `templates/` CONVENTIONS.md, GOAL.md, prompts/ (component-builder, part-builder, motion-ripper)
- `src/page/ct.js` the in-page measuring library (same code on reference and build)
- `src/lib/anon.ts` the origin blackout
