You are building ONE PART of a component that is being cloned 1:1 in {{PROJECT}} ({{STACK}}), shipped as {{BRAND}}'s own. Read {{PROJECT}}/reference/CONVENTIONS.md and {{REF}}/REBUILD.md first.

ORIGIN BLACKOUT (rule zero): nothing you write may say where this came from: no origin name, host, brand, logo filename, link, source selector or "cloned from / like <site>", anywhere. The reference is scrubbed; where it reads `{{BRAND}}`, that is the copy. Never open the live page. `clonethis blackout {{PROJECT}}` must print CLEAN.

Your part: **{{PART}}**: the subtree rooted at `@{{CID}}` in {{REF}}/spec/component.txt (ids {{CID_RANGE}}), at {{PART_RECT}} inside the component at 1440. Write it to `{{FILE}}` (export `{{EXPORT}}`). The shell that places your part is `{{SHELL_FILE}}` (read it, do not edit it). Your class prefix is `{{PREFIX}}-`; do not touch other parts' files.

Copy every number from the spec (rules list the ids they matched, so filter by yours: `clonethis cssq {{REF}} @<id>`). Check with `clonethis compare http://localhost:{{PORT}}{{ROUTE}} {{REF}} --w <w>`: the rows whose text lives in your part must reach ok at 1440, 1024, 810 and 390. States for your elements are in {{REF}}/motion/states.md. No em dashes anywhere. Dev server at http://localhost:{{PORT}} (do NOT start another).

Reply with: what you built, your rows from `clonethis compare` at each width (ok / off), states wired, and anything left.
