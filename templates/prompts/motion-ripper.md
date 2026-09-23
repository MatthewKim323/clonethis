You are writing the motion spec for ONE captured component so it can be rebuilt 1:1 in {{STACK}}. Everything is on disk at {{REF_ABS}}/. Write only to {{REF_ABS}}/motion/. Do NOT open the live page or look up where the capture came from.

ORIGIN BLACKOUT: the files are scrubbed (origin words read as `{{BRAND}}`). Nothing you write may name the origin. Call it "the component".

Inputs:
- motion/animations.json: every running animation in the component at capture time, per width: type (CSSAnimation / CSSTransition / Animation = WAAPI, which is what motion / Framer appears are), target element id (`cN` = data-ct-id, see spec/component.txt), keyframes, timing (duration, delay, easing, iterations, fill).
- motion/states.md + capture/states/states.json: hover / press / focus / open: every property that changed, from -> to, and the computed transition in effect.
- motion/transitions.json: computed transition / animation per element at rest. motion/keyframes.css: the @keyframes it uses.
- motion/frames.md + capture/frames/<scenario>/{frames.json,motion-timeline.json}: when motion happens (ms ranges) in the entrance (load or scroll-in), hover / toggle, loop recordings. Use the timelines to check durations and delays, not to invent values.
- Framer pages: motion/framer-appear.json (appear animations keyed by appear id; the tree in spec/component.txt shows `appear=<id>` per element), motion/rip.md + constants.json (module windows focused on this component: transition constants, `__framer__transformTargets` scroll effects, `tokenization` text effects, `tickerEffect*`, hover variants), modules/.

Deliverables:
1. motion/component-spec.md: per element (by `cN` id and a readable label from the tree): mechanism (css transition, css keyframes, waapi / motion appear, framer scroll-transform, text effect, ticker, loop, gesture variant), exact initial / animate / transition values, trigger (mount, in-view, scroll-progress, hover, focus, press, click), and the code to write it in {{STACK}}. Hover / focus / press / open from states.md with their transitions. A glossary of every spring / tween constant at the top.
2. motion/component-spec.json: the same, machine readable: { constants, elements: [{ cid, label, mechanism, trigger, initial, animate, transition, spring, keyframes, timing, states: { hover, focus, press, open } }] }.

Rules: quote exact numbers from the files. Never invent or round (`cubic-bezier(0.44, 0, 0.56, 1)` stays that). Say what is uncertain instead of guessing. No em dashes. Reply with a 15 line summary: mechanisms found, constants, anything surprising (a loop that pauses on hover, a scroll-linked effect, an animation the static snapshot cannot show).
