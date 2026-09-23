# Conventions: {{COMP}} ({{NAME}})

Goal: a pixel-and-motion 1:1 clone of one captured component, shipped as {{BRAND}}'s own, in {{STACK}}. Measured, not "inspired by".

Project: `{{PROJECT}}`. Dev server already running at http://localhost:{{PORT}} (do NOT start another). Reference: `{{REF_ABS}}/` (read `REBUILD.md` there first). Rigs: `clonethis <cmd>` (`clonethis help`).

## Origin blackout (rule zero)
Nothing you write may say where this came from. No origin name, host, brand, logo filename, link, source selector or "cloned from / based on / like <site>" anywhere: not in a component, file name, class name, CSS comment, code comment, alt text, metadata, doc, commit message or reply. This is {{BRAND}}'s component.
- The reference is already scrubbed: where it reads `{{BRAND}}`, that is the copy. Copy text from `spec/` or `dom/` and you stay clean. Never copy from a live browser tab, never look up the source url (it lives in `{{REF}}/.origin.json` for the rigs only).
- Assets are content addressed (`img-<hash>.webp`, `font-<hash>.woff2`). Keep those names when you copy them into the project. A logo / wordmark still carries the origin visually: placeholder, neutral name, say so.
- `clonethis blackout {{PROJECT}}` must print CLEAN. `clonethis verify` runs it and FAILs on a hit.

## Where it goes
- Component: `{{FILE}}`, export `{{COMP}}`. Its root element carries `data-clone-root` (that is how every rig finds it).
- Verify page: `{{PAGE}}`, served at http://localhost:{{PORT}}{{ROUTE}}. Renders the component and nothing else, on the backdrop color from `capture/desktop/context.json` (`backdrop`). No page padding that would squeeze it.
- Sizes to hit (root border box, from the capture): {{SIZES}}. Widths: {{WIDTHS}}.

## Ground truth (read these, never guess)
- `spec/component.txt`: the tree (`@cN` ids, classes, inline styles, text) and every css rule that applies: at rest, per breakpoint / condition, per state, with the ids each matched. Copy numbers from here.
- `css/used.css`: the same rules as a stylesheet in cascade order + the @font-face and @keyframes they need. You may port it wholesale into the component's stylesheet (rename classes to your namespace consistently) or translate it; either way values stay exact. Custom properties per width: `css/vars.json`; the type the component inherits from its page: `capture/<vp>/context.json` `inherited` (set it on the root if your page does not provide it).
- `dom/component.html` (and `dom/<vp>.html` when the html variant differs per width, see REBUILD.md): the structure, real text, real attributes, local asset paths.
- `capture/<vp>/component.png`: what it must look like, 2x, exactly the root's box. `capture/<vp>/layout.json`: every element's rect relative to the root + computed styles; `clonethis refboxes {{REF}} <vp>` prints it. `texts.json`: every painted text run with its glyph box: the thing verify compares.
- `motion/states.md` + `capture/states/*.png`: hover / press / focus / open, every property that changed and the transition in effect. `motion/frames.md` + `capture/frames/`: how it enters, hovers, toggles, loops. `motion/animations.json`: running animations with keyframes + timing. Framer pages: `motion/framer-appear.json`, `motion/rip.md`, `motion/constants.json`.
- `snapshot/index.html` (`clonethis serve {{REF}}`): the component standing alone as static html + css. A working reference to read from; not the deliverable.

## Rules
1. Structure follows `dom/component.html`: same nesting where it decides layout, same text (typographic quotes and all), same attributes that matter (alt, aria-*, role, type). Drop wrappers that do nothing only if `clonethis compare` still passes.
2. Styling: {{STYLING}}. Copy paddings / gaps / radii / sizes / typography / colors / shadows / transforms from the spec. Never eyeball a number, never round one.
3. Breakpoints: reproduce every `@media` block from the spec with the same conditions. The component is verified at {{WIDTHS}}.
4. The root's width comes from where it sits (verify pins it to the reference width), so do not hard-code the root width unless the spec does. Everything inside must come out right at the pinned width. If `context.json` says the height came from its container, verify pins that too.
5. States: every hover / focus / active / open change in `motion/states.md` with the same transition (property, duration, easing, delay). `clonethis states <url> {{REF}}` compares yours.
6. Motion: {{MOTION}}. Values from source (`animations.json` keyframes + timing, `states.md` transitions, the Framer rip), never from eyeballing frames; frames are for checking timing. Framer scroll "Enter" effects are scroll-progress-linked springs, not whileInView.
7. Fonts: `@font-face` from `css/used.css` with the font files from `assets/fonts/` copied into the project. A fallback font fails verify: the glyph boxes move.
8. Images / svgs / video: copy from `assets/` (keep names). Inline svg stays inline (copy the markup). `dom/symbols.svg` holds `<symbol>` / gradient defs the component references from outside itself.
9. No em dashes anywhere (code, comments, copy you write).

## The loop
```bash
clonethis shot http://localhost:{{PORT}}{{ROUTE}} {{REF}}/build/1440.png --ref {{REF}} --w 1440     # Read it next to capture/desktop/component.png
clonethis compare http://localhost:{{PORT}}{{ROUTE}} {{REF}} --w 1440                             # text runs + media: dx dy dw dh, font, color
clonethis boxes http://localhost:{{PORT}}{{ROUTE}} 1440 --ref {{REF}}   vs   clonethis refboxes {{REF}} desktop
clonethis states http://localhost:{{PORT}}{{ROUTE}} {{REF}}
clonethis verify http://localhost:{{PORT}}{{ROUTE}} {{REF}}                                      # PASS at every width, or keep going
```
Then `--w 1024`, `--w 810`, `--w 390` the same way. `bunx tsc --noEmit` (when TypeScript) must pass. `clonethis blackout {{PROJECT}}` CLEAN.
