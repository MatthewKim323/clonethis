You are building ONE component, 1:1 with a captured reference, in {{PROJECT}} ({{STACK}}), shipped as {{BRAND}}'s own. First read {{PROJECT}}/reference/CONVENTIONS.md fully, then {{REF}}/REBUILD.md, and follow them exactly.

ORIGIN BLACKOUT (rule zero): nothing you write may say where this came from. No origin name, host, brand, logo filename, link, source selector, or "cloned from / based on / like <site>" in any file, class name, comment, alt text, metadata, doc or reply. The reference is already scrubbed: where it reads `{{BRAND}}`, that is the copy. Never look up the source url or open the live page. `clonethis blackout {{PROJECT}}` must print CLEAN before you report done.

Your files: `{{FILE}}` (export `{{COMP}}`, root element carries `data-clone-root`) and the verify page `{{PAGE}}`. You may add a stylesheet next to the component and copy assets from {{REF}}/assets/ (keep their names). Do not touch anything else. The dev server runs at http://localhost:{{PORT}} (do NOT start another).

Inputs:
- Spec: {{REF}}/spec/component.txt (tree + every rule, at rest / per breakpoint / per state). Stylesheet form: {{REF}}/css/used.css. Structure: {{REF}}/dom/component.html{{VARIANT_NOTE}}.
- Look: {{REF}}/capture/<vp>/component.png at desktop, tablet, tablet-810, mobile (2x, exactly the root's box). Sizes: {{SIZES}}.
- Boxes: `clonethis refboxes {{REF}} <vp>`; text runs: {{REF}}/capture/<vp>/texts.json.
- States: {{REF}}/motion/states.md. Motion: {{REF}}/motion/frames.md, animations.json, transitions.json{{FRAMER_NOTE}}.

Process: build the static layout first, at 1440. `clonethis shot http://localhost:{{PORT}}{{ROUTE}} {{REF}}/build/1440.png --ref {{REF}} --w 1440`, Read it next to capture/desktop/component.png, then `clonethis compare http://localhost:{{PORT}}{{ROUTE}} {{REF}} --w 1440` and fix every row that is off (it names the text run, the delta and the font / color difference). Repeat at 1024, 810 and 390. Then states (`clonethis states ...`), then motion (`clonethis frames ... --scenario enter|hover|toggle|loop --ref {{REF}}` + `clonethis sheet` against the capture's frames at the same step). Finish with `clonethis verify http://localhost:{{PORT}}{{ROUTE}} {{REF}}` until PASS at every width. Typecheck must pass. No em dashes anywhere.

Reply with: what you built, the verify table (per width: height, text runs ok / total, media, pixel %), the states comparison, anything that still does not match and why (be honest), and any placeholder asset (logo / wordmark) left.
