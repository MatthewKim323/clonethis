/**
 * A small, string-aware CSS reader. Enough to take a production stylesheet apart into rules with their
 * at-rule context (media / supports / layer / container), keep the ones a component uses, and write them
 * back out. Comments and strings are respected, so `content:"}"` does not end a block.
 */

export type StyleRule = { kind: 'style'; conds: string[]; selector: string; body: string; order: number };
export type AtomRule = { kind: 'atom'; conds: string[]; name: string; prelude: string; body: string; order: number };
export type Rule = StyleRule | AtomRule;

/** At-rules whose block holds more rules: descend and carry the condition. */
const GROUPING = new Set(['media', 'supports', 'layer', 'container', 'scope', 'document', '-moz-document', 'starting-style']);

function stripComments(css: string) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '\\') { out += css.slice(i, i + 2); i += 2; continue; }   // escaped char outside a string (`.content-\[\'\'\]`)
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n && css[j] !== q) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
    } else { out += c; i++; }
  }
  return out;
}

/** Index of the brace that closes the block opened at `open` (css[open] === '{'), string aware. */
function closeOf(css: string, open: number) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; } continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return css.length;
}

/** Next `{`, `;` or `}` at paren depth 0 from i, string aware. */
function nextStop(css: string, i: number): { at: number; ch: string } {
  let paren = 0;
  for (; i < css.length; i++) {
    const c = css[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; } continue; }
    if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (paren === 0 && (c === '{' || c === ';' || c === '}')) return { at: i, ch: c };
  }
  return { at: css.length, ch: '' };
}

export function parseCss(text: string): Rule[] {
  const css = stripComments(text);
  const out: Rule[] = [];
  let order = 0;
  const walk = (s: string, conds: string[]) => {
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      const stop = nextStop(s, i);
      if (!stop.ch) break;
      const head = s.slice(i, stop.at).trim();
      if (stop.ch === ';' || stop.ch === '}') {
        // @import / @charset / @layer a, b; / stray
        if (head.startsWith('@')) {
          const m = head.match(/^@([\w-]+)\s*([\s\S]*)$/);
          if (m && m[1] !== 'charset') out.push({ kind: 'atom', conds, name: m[1], prelude: m[2].trim(), body: '', order: order++ });
        }
        i = stop.at + 1;
        continue;
      }
      const end = closeOf(s, stop.at);
      const body = s.slice(stop.at + 1, end);
      if (head.startsWith('@')) {
        const m = head.match(/^@([\w-]+)\s*([\s\S]*)$/);
        const name = m ? m[1].toLowerCase() : '';
        const prelude = m ? m[2].trim().replace(/\s+/g, ' ') : '';
        if (GROUPING.has(name) && !(name === 'layer' && !body.includes('{'))) walk(body, [...conds, `@${name}${prelude ? ' ' + prelude : ''}`]);
        else out.push({ kind: 'atom', conds, name, prelude, body: body.trim(), order: order++ });
      } else if (head) {
        out.push({ kind: 'style', conds, selector: head.replace(/\s+/g, ' '), body: body.trim(), order: order++ });
      }
      i = end + 1;
    }
  };
  walk(css, []);
  return out;
}

/** Split a selector list on top-level commas (not inside :is(), :not(), [attr="a,b"]). */
export function splitSelectors(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', q = '';
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { cur += c; if (c === '\\') { cur += sel[++i] ?? ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (sel[++i] ?? ''); continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|visited|link|any-link|target|checked|indeterminate|placeholder-shown|autofill|-webkit-autofill|user-invalid|user-valid|invalid|valid|open|popover-open|modal|fullscreen|defined|playing|paused)(?![\w-])/g;
const PSEUDO_EL = /::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|part\([^)]*\)|slotted\([^)]*\))/g;

/**
 * A selector reduced to what can be tested with `matches()` on a static DOM: state pseudo-classes and pseudo
 * elements removed. `.card:hover .title::after` -> `.card .title`. Returns '' when nothing testable is left.
 */
export function testable(sel: string): string {
  let s = sel.replace(PSEUDO_EL, '').replace(DYNAMIC, '');
  s = s.replace(/:(where|is|not|has)\(\s*\)/g, '');
  s = s.replace(/\s*([>+~])\s*$/, '').trim();
  if (!s || /^[>+~]/.test(s)) return '';
  return s;
}

/** The states and pseudo elements a selector carries: hover, focus, ::before ... */
export function stateOf(sel: string): string[] {
  const out = new Set<string>();
  for (const m of sel.matchAll(DYNAMIC)) out.add(m[1]);
  for (const m of sel.matchAll(PSEUDO_EL)) out.add('::' + m[1].replace(/\(.*$/, ''));
  return [...out];
}

const ATOM_BLOCKS = /^(font-face|keyframes|-webkit-keyframes|property|counter-style|page|font-feature-values|font-palette-values|view-transition|position-try)$/;

/** Write rules back out, reopening their at-rule context. Consecutive rules sharing a context share a block. */
export function writeCss(rules: Rule[], indent = '  '): string {
  const L: string[] = [];
  const open: string[] = [];
  const close = (to: number) => { while (open.length > to) { open.pop(); L.push(indent.repeat(open.length) + '}'); } };
  for (const r of rules) {
    let k = 0;
    while (k < open.length && k < r.conds.length && open[k] === r.conds[k]) k++;
    close(k);
    for (let j = k; j < r.conds.length; j++) { L.push(indent.repeat(open.length) + r.conds[j] + ' {'); open.push(r.conds[j]); }
    const pad = indent.repeat(open.length);
    if (r.kind === 'style') L.push(`${pad}${r.selector} { ${r.body} }`);
    else if (!r.body && !ATOM_BLOCKS.test(r.name)) L.push(`${pad}@${r.name} ${r.prelude};`);
    else L.push(`${pad}@${r.name}${r.prelude ? ' ' + r.prelude : ''} {\n${r.body.split('\n').map((x) => pad + indent + x.trim()).filter((x) => x.trim()).join('\n')}\n${pad}}`);
  }
  close(0);
  return L.join('\n') + '\n';
}

/** Names of @keyframes referenced by animation / animation-name in a declaration block. */
export function animationNames(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[;{\s])animation(?:-name)?\s*:\s*([^;]+)/g)) {
    for (const part of m[1].split(',')) {
      for (const w of part.trim().split(/\s+/)) {
        if (/^(-?[\d.]|infinite|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps\(|cubic-bezier\(|linear\(|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|none|running|paused|initial|inherit|unset|var\(|!important)/.test(w)) continue;
        out.add(w.replace(/[,"')]/g, ''));
      }
    }
  }
  return [...out].filter(Boolean);
}

/** var(--x) references in a declaration block. */
export function varRefs(body: string): string[] {
  return [...new Set([...body.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))];
}

/** Family name declared by an @font-face body. */
export function fontFaceFamily(body: string): string | null {
  const m = body.match(/font-family\s*:\s*([^;]+)/);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

/** url(...) values in a declaration block, resolved against base. */
export function cssUrls(body: string, base: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const u = m[2];
    if (!u || u.startsWith('data:') || u.startsWith('#')) continue;
    try { out.push(new URL(u, base).href); } catch {}
  }
  return out;
}

/** Rewrite url(...) in a declaration block through a mapper (absolute url -> local path, or null to keep it absolute). */
export function rewriteUrls(body: string, base: string, map: (abs: string) => string | null): string {
  return body.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (whole, _q, u) => {
    if (!u || u.startsWith('data:') || u.startsWith('#')) return whole;
    let abs: string;
    try { abs = new URL(u, base).href; } catch { return whole; }
    const local = map(abs);
    return local ? `url("${local}")` : `url("${abs}")`;
  });
}

// ---------------------------------------------------------------- Framer spec helpers

/** (media, selector, body) triples; media is the @media chain joined with `and`. */
export function* cssBlocks(css: string): Generator<{ media: string; selector: string; body: string }> {
  for (const r of parseCss(css)) {
    if (r.kind !== 'style') continue;
    yield { media: r.conds.filter((c) => c.startsWith('@media')).join(' and '), selector: r.selector, body: r.body };
  }
}

/** Drop the Framer noise nobody needs when rebuilding. */
export function cleanBody(body: string) {
  let b = body.replace(/--framer-font-family-(bold|italic|bold-italic):[^;]+;/g, '');
  b = b.replace(/--framer-font-(style|weight)-(bold|italic|bold-italic):[^;]+;/g, '');
  b = b.replace(/--framer-(text-stroke-[a-z]+|font-variation-axes|font-open-type-features|text-decoration|paragraph-spacing|text-transform|font-style|link-text-color|link-text-decoration):[^;]+;/g, '');
  b = b.replace('will-change:var(--framer-will-change-override,transform);', '').replace('will-change:var(--framer-will-change-effect-override,transform);', '');
  b = b.replace('overflow:var(--overflow-clip-fallback,clip)', 'overflow:clip');
  return b;
}
