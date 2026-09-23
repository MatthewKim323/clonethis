# Orchestration

A component is usually one agent's job: a card, a button, a nav bar, a hero. Split only when the component is big enough that two agents would not touch the same file.

## When to split

| component | plan |
|---|---|
| < ~60 elements (card, button, nav bar, testimonial, CTA block) | build it yourself, start to finish |
| 60 to 300 elements with separable regions (footer with 4 columns, mega menu, bento grid, pricing table) | you build the shell (root, grid / flex skeleton, tokens, fonts, shared primitives like Button / Icon), then one `part-builder` per region, in parallel |
| any size with real motion (springs, scroll-linked, text effects, tickers, a Framer page) | one `motion-ripper` in parallel with the layout work; the motion pass waits for its spec |

Regions come from the tree in `spec/component.txt`: pick subtrees by `@cN` id whose boxes do not overlap (`clonethis refboxes <ref> desktop --depth 2`).

## What every agent needs in its prompt

- the project path, the dev url and port, "do not start another dev server"
- `reference/CONVENTIONS.md` (read fully first) and the reference's `REBUILD.md`
- exactly which files it owns and which it must not touch; its class prefix
- for a part: its subtree id range and its rect inside the component at 1440
- the check loop: `clonethis compare` rows for its part at 1440 / 1024 / 810 / 390
- rule zero verbatim, and `clonethis blackout <project>` CLEAN before reporting. Never tell an agent what the source site is, never paste the url or the source selector into a prompt; rigs take `"$(clonethis origin <ref> --url)"` when they need the live page (they almost never do: verify runs against the reference folder)
- what to reply with: what was built, the compare / verify rows, what is still off, placeholders

## Failure handling

- Rate limits / overload: resume the agent by id (SendMessage keeps its context) after a back-off, or relaunch on another model. The reference folder is durable.
- An agent that "finished" with rows still off gets a follow-up with the exact `compare` output for its part, not a rebuild.
- Two parts extending one shared primitive: tell both to extend backward-compatibly and to re-read the file before editing.
