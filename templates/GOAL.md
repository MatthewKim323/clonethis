# Goal text

Set this with `/goal` when the job starts (Claude Code's session-scoped stop hook keeps the session working until the condition holds). Keep it objective. Never write the source url or the source selector into it: it is session-visible, and the clone never names its origin.

```
/goal Clone the captured {{NAME}} component 1:1 into {{PROJECT}} as {{BRAND}}'s own {{COMP}} ({{FILE}}, root marked data-clone-root, rendered at http://localhost:{{PORT}}{{ROUTE}}). Done means `clonethis verify http://localhost:{{PORT}}{{ROUTE}} {{REF}}` reports PASS at {{WIDTHS}}: root height equal, every text run within 1px with the same line count, every media box within 1px, pixel diff under 3%, zero console errors, origin blackout CLEAN; hover / press / focus / open states match `clonethis states` (same properties, same transitions); entrance and loop timing checked against capture/frames with `clonethis frames` + `clonethis sheet`; typecheck and build green. Do not stop at "close": find every remaining pixel with clonethis compare. Boil the ocean.
```

Shorter, when the user said it in their own words: keep their phrasing, append the measurable part:

```
/goal <user's words>. Measurable: clonethis verify PASS at {{WIDTHS}} (blackout CLEAN included), clonethis states matching, typecheck + build green.
```
