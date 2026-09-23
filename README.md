# clonethis

Clone one component off any live site, 1:1. A CLI plus a Claude Code skill: point at a pricing card, a navbar, a hero, a footer, a button. You get the measured truth of that one element subtree at every width, a standalone snapshot that proves the extraction is complete, and a gate that says PASS only when your build matches it.

It is the component-sized sibling of [1to1](https://github.com/MatthewKim323/1to1), which clones whole pages. Same method: measure instead of guess, define done as numbers matching, never name the source.

## Why not screenshot it and "make it look like this"

Because the model then invents the padding, rounds the letter spacing, picks a font that is close, and guesses the hover. clonethis hands over what the browser actually computed:

- **every css rule that styles it**, from every stylesheet on the page, for every breakpoint and every state (not just the ones active at the widths it was captured at), in cascade order, with the @font-face, @keyframes and custom properties they use. Tailwind pages give you exactly the utilities the component uses
- **boxes**: every element in the subtree with its rect relative to the component root and its computed styles, at 1440 / 1024 / 810 / 390
- **painted text runs**: the glyph box of every text node. Font, size, weight, line height, tracking and wrapping in one number each
- **states, measured**: hover, press, focus and open on every interactive element, as `property: from -> to` with the transition in effect, plus shots
- **motion**: running animations with keyframes and timing (CSS and WAAPI, so motion / Framer appears too), 60fps screencasts of the entrance, hovers, toggles and loops cropped to the component, and a Framer module rip focused on the component
- **a snapshot**: the component standing alone (its html, used css, fonts, assets, inherited type and the ancestor chain its selectors need), run through the same gate as your build. PASS means nothing was left behind

## Install

```bash
git clone https://github.com/MatthewKim323/clonethis ~/.claude/skills/clonethis
cd ~/.claude/skills/clonethis && bun install   # or npm install
export PATH="$HOME/.claude/skills/clonethis/bin:$PATH"
clonethis help
```

Needs Node >= 22.18 (the CLI is TypeScript run by Node's native type stripping) and bun or npm to install. Chromium is installed on first run.

Why Node and not bun, when 1to1 runs on bun: every rig here screenshots with Chromium and crunches pixels with sharp in the same process, and under bun that combination wedges Playwright's connection to the browser (reproducible: a screencast followed by sharp work hangs `context.close` about one run in three). Under Node it does not.

## Use

```bash
clonethis find https://example.com/ "Most popular"          # which element? hits + ancestor chains + outlined shots
clonethis pick https://example.com/                         # or point at it in a real window
clonethis grab https://example.com/ --select "article.plan.featured" --as pricing-card --brand Aurora
clonethis init ~/dev/myapp --ref reference/pricing-card      # CONVENTIONS.md + GOAL.md for the project's stack

# build it, root element marked data-clone-root, rendered at e.g. /clonethis/pricing-card

clonethis compare http://localhost:3777/clonethis/pricing-card reference/pricing-card --w 1440
clonethis states  http://localhost:3777/clonethis/pricing-card reference/pricing-card
clonethis verify  http://localhost:3777/clonethis/pricing-card reference/pricing-card
clonethis blackout .
```

As a Claude Code skill: "clone the pricing card from https://..." The agent finds the element (asking when "the card" could mean two things), grabs it, sets a `/goal`, builds it into your project and verifies until PASS.

## The gate

Per width, with the component's width pinned to the reference (its container decides its width; the component decides everything inside):

| check | rule |
|---|---|
| root | height equal (0.5px) |
| text runs | every reference run found with the same text, within 1px on x, y, w, h, same line count |
| media | img / svg / video / canvas boxes within 1px |
| pixels | < 3% of pixels off, live media masked |
| console | zero errors |
| blackout | nothing in the project names the origin |

## What a reference folder holds

```
reference/<name>/
  REBUILD.md                   start here: sizes per width, snapshot self-check, states, motion, the loop
  .origin.json                 the only file that names the source (url, title, source selector); gitignored by init
  component.json               sizes, element counts, css stats, html variants per width
  spec/component.txt           tree (@cN ids, classes, inline styles, text) + every rule: at rest / by breakpoint / by state
  css/used.css rules.json vars.json
  dom/component.html <vp>.html symbols.svg
  capture/<vp>/component.png context.png layout.json texts.json media.json context.json interactive.json animations.json
  capture/states/states.json + *.png         hover / press / focus / open
  capture/frames/<scenario>/                 enter or load, hover-NN, toggle-NN, loop: frames + timelines
  motion/states.md frames.md transitions.json animations.json keyframes.css  (+ framer-appear.json rip.md constants.json on Framer pages)
  assets/{images,fonts,videos}/              content addressed: img-<sha1>.webp, font-<sha1>.woff2
  snapshot/index.html check.json             the component alone, and how it scored on the gate
```

## Origin blackout

What comes out is yours. The live component is rebranded in the page before anything is measured (its copy and alt text say your brand), so the reference is the component as it will read in your project, screenshots included. Reference dirs are named by role, assets by their bytes, and everything written is scrubbed: the origin's words read as your brand (`--brand`, default the project folder), links back to it become route-relative. The url and the source selector live only in `.origin.json`. `clonethis blackout <project>` scans the project and `verify` fails on a hit. A logo inside the component still shows the origin visually: treat it as a placeholder.

## Tested on

- `bun run test` / `node test/e2e.ts`: a local fixture (a pricing card with web fonts, a looping badge, hover / press / focus transitions, a disclosure, ancestor-qualified rules, escaped utility classes, a phone breakpoint). The snapshot passes the gate at all four widths; states, fonts, keyframes and blackout are checked.
- The same card built by hand into a fresh Next.js app from the reference alone: `verify` PASS at 1440 / 1024 / 810 / 390, `states` 3 of 3 targets matching. Changing one font size from 13px to 14px fails it and `compare` names the runs and the font.
- Live: a production Next.js site's sticky header (144 stylesheets, 6.4k rules), a Framer pricing card whose height comes from its grid row, and a Tailwind v4 button (cascade layers, native nesting, `@property`, a separate mobile variant). All three snapshots pass the gate at every width.

## Limits

- The element must be in the main document (no iframes, no shadow DOM).
- No authenticated pages (no cookie injection).
- Script-driven behaviour (JS-measured layout, carousels, canvas / WebGL) is captured as frames, animations and module source, not as something the static snapshot can hold. The self-check table says where.
- States cover pointer and keyboard on elements inside the component. Things that open elsewhere on the page (a modal the button launches) are out of scope: grab them separately.
- Screencasts are desktop only.
- `pick` opens a real browser window and waits for a click; it is the one command without an automated test.

## Docs

- [SKILL.md](SKILL.md): the agent's flow
- [docs/METHOD.md](docs/METHOD.md): the method and why each step exists
- [docs/SELECT.md](docs/SELECT.md): choosing the element
- [docs/VERIFY.md](docs/VERIFY.md): the gate and the last-pixel loop
- [docs/AGENTS.md](docs/AGENTS.md): when to split a component across agents

MIT
