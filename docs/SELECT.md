# Choosing the element

"Clone the pricing card" names a thing a person sees. The tool needs one element whose subtree is that thing. Get this wrong and everything downstream is measured perfectly and useless.

## The right level

`clonethis find <url> "<query>"` prints each hit with its ancestor chain, one row per level:

```
  up  size          desc  tag / name / classes          selector
   0  277x48           0  button .cta                    button.cta  --nth 1 (of 3)
   1  341x755         26  article .plan-card.featured    article.plan-card.featured
   2  1120x947        37  section .pricing               section.pricing
```

and writes `find/<n>.png` with every level outlined in its own color. Pick the level whose box is the component's **visual edge**: where its background, border, radius, shadow or padding stops. Heuristics:

- Too low: the box hugs the text or a single child; the component's padding or background is outside it.
- Too high: the box includes siblings (the other two cards), section padding, or the section heading.
- Framer pages: the right level usually has a meaningful `data-framer-name` (`Card`, `Pricing Card`, `Navigation`); generic names (`Container`, `Wrapper`, `Desktop`) are layout shells.
- When two levels are both plausible (the card vs the grid of cards, the nav bar vs the header that contains it and an announcement bar), ask the user and show both sizes. It is a scope question, not a technical one.

`clonethis pick <url>` does the same interactively: the user hovers, climbs with `[` / ArrowUp, clicks to take it, and the command prints the selector.

## Ways to name it

| flag | when |
|---|---|
| `--select "<css>" [--nth N]` | you have a selector from `find` / `pick`. `--nth` indexes the *visible* matches |
| `--text "<visible text>" --up N` | quick: the element containing that text, climbed N levels (same numbers as `find`) |
| `--name "<layer>"` | Framer: `[data-framer-name="<layer>"]` |

Whatever you pass, `grab` resolves it once, then writes a canonical locator (selector + nth, plus text when the selector alone is ambiguous) to `.origin.json` and re-finds the element with it at every width. The locator can hold the origin's class names, which is why it lives only in `.origin.json`. `clonethis origin <ref> --selector` prints it for scripting.

## Edge cases

- **Repeated components** (three pricing cards, eight logos): pick the richest instance (the featured card has the badge and the outline), then check the others share the structure in `find`'s descendant counts. Build one component with props; verify against the grabbed instance.
- **Breakpoint swaps**: some pages render a different subtree per breakpoint (Framer variants, a desktop nav and a mobile drawer). If the locator does not match at a width, that width is recorded missing. Grab the other variant separately (`--as nav-mobile`) and build one component that switches at the same breakpoint. If it matches but the html differs per width, REBUILD.md's "html variant" column shows it and `dom/<vp>.html` holds each.
- **Fixed / sticky components** (navs, cookie bars, floating buttons): fine. Other fixed things are hidden while shooting; the component itself is kept. The snapshot unpins it (`position: relative`) so it can be measured in flow. Scroll-driven behaviour (hide on scroll, shrink) shows up in the frames, not in the static capture.
- **Inside a slider / carousel / marquee**: the element moves by itself. The capture takes it at a moment; the loop recording and `animations.json` hold the motion. Consider grabbing the whole slider rather than one slide.
- **Overlays** (menus, modals, dropdowns) that only exist after a click: open them first with a selector that matches the open state, or grab the trigger and read the open state from `capture/states/*-open.png` and `states.md`. For a modal, grab it with `--select` on the modal after opening it by hand in `pick` mode.
- **Hidden until scrolled** (scroll reveals): `grab` runs the page's reveal pass (scroll top to bottom) before measuring, so the component is at rest. The entrance itself is in `capture/frames/enter`.
- **Iframes / shadow DOM**: not supported. The element must be in the main document.
