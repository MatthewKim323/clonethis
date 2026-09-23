/**
 * In-page library. Injected once per page as `window.__ct` (see lib/page.ts). Plain JS so it runs as-is in
 * any page: no bundler helpers, no imports. Everything that has to be measured identically on the reference
 * and on the build lives here, so both sides go through the same code.
 */
(() => {
  if (window.__ct) return;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);
  const HASHY = /^(framer-v-|framer-[a-z0-9]{5,}$|css-[a-z0-9]{4,}|sc-[a-zA-Z]{4,}|_[a-zA-Z0-9]{5,}|jsx-\d+|svelte-[a-z0-9]+|astro-[a-z0-9]+|data-v-|hidden-[a-z0-9]+|ssr-variant)/;
  const LAYOUT_PROPS = ['position', 'display', 'boxSizing', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'alignItems', 'alignSelf', 'justifyContent', 'justifySelf', 'alignContent', 'gap', 'rowGap', 'columnGap', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'order', 'top', 'right', 'bottom', 'left', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatio', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderRadius', 'outline', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform', 'textDecorationLine', 'textDecorationColor', 'textShadow', 'whiteSpace', 'textOverflow', 'fontFeatureSettings', 'fontVariationSettings', 'WebkitFontSmoothing', 'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip', 'boxShadow', 'opacity', 'transform', 'transformOrigin', 'filter', 'backdropFilter', 'mixBlendMode', 'clipPath', 'maskImage', 'overflow', 'overflowX', 'overflowY', 'zIndex', 'objectFit', 'objectPosition', 'cursor', 'pointerEvents', 'visibility', 'transition', 'animation', 'willChange', 'content', 'fill', 'stroke', 'strokeWidth'];
  // what a hover / focus / press can change; diffed before and after
  const STATE_PROPS = ['color', 'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopWidth', 'borderRadius', 'boxShadow', 'outline', 'outlineColor', 'outlineOffset', 'opacity', 'transform', 'filter', 'backdropFilter', 'textDecorationLine', 'textDecorationColor', 'textUnderlineOffset', 'letterSpacing', 'fontWeight', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginLeft', 'gap', 'top', 'left', 'right', 'bottom', 'visibility', 'display', 'clipPath', 'maskImage', 'fill', 'stroke', 'scale', 'rotate', 'translate', 'zIndex', 'cursor'];
  const INHERITED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'color', 'textAlign', 'textTransform', 'whiteSpace', 'fontFeatureSettings', 'fontVariationSettings', 'WebkitFontSmoothing', 'textRendering', 'direction', 'cursor', 'listStyleType', 'visibility'];
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()).replace(/^webkit-/, '-webkit-');
  const r2 = (n) => Math.round(n * 100) / 100;

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
  }
  function cls(el) {
    const c = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    return c.split(/\s+/).filter(Boolean);
  }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (m) => '\\' + m); }
  function attrSel(k, v) { return `[${k}="${String(v).replace(/"/g, '\\"')}"]`; }
  function visibleMatches(sel) {
    let list;
    try { list = document.querySelectorAll(sel); } catch { return null; }
    return Array.from(list).filter(visible);
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function pageRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r2(r.left + scrollX), y: r2(r.top + scrollY), w: r2(r.width), h: r2(r.height) };
  }
  function goodId(id) { return id && /^[A-Za-z][\w-]{1,60}$/.test(id) && !/\d{4,}/.test(id) && !/^(radix|headlessui|react-aria|mui|:r)/i.test(id); }

  /** A selector for el that survives a fresh load at another width: {selector, nth} where nth indexes the visible matches. */
  function selectorFor(el) {
    if (el === document.body || el === document.documentElement) return { selector: el.tagName.toLowerCase(), nth: 0, count: 1 };
    const tries = [];
    const tag = el.tagName.toLowerCase();
    if (goodId(el.id)) tries.push('#' + esc(el.id));
    const fn = el.getAttribute('data-framer-name');
    if (fn) tries.push(tag + attrSel('data-framer-name', fn), attrSel('data-framer-name', fn));
    for (const k of ['data-testid', 'data-test', 'data-component', 'data-section', 'data-block', 'data-slot', 'aria-label', 'name', 'role']) {
      const v = el.getAttribute(k);
      if (v && v.length < 80) tries.push(tag + attrSel(k, v));
    }
    const good = cls(el).filter((c) => !HASHY.test(c) && c.length < 60 && !/[:[\]/]/.test(c));
    if (good.length) {
      tries.push(tag + '.' + good.slice(0, 1).map(esc).join('.'));
      if (good.length > 1) tries.push(tag + '.' + good.slice(0, 2).map(esc).join('.'));
      if (good.length > 2) tries.push(tag + '.' + good.slice(0, 4).map(esc).join('.'));
    }
    const score = (sel) => { const m = visibleMatches(sel); return m && m.includes(el) ? m : null; };
    let best = null;
    for (const s of tries) {
      const m = score(s);
      if (!m) continue;
      if (m.length === 1) return { selector: s, nth: 0, count: 1 };
      if (!best || m.length < best.count) best = { selector: s, nth: m.indexOf(el), count: m.length };
    }
    // qualify with the nearest anchored ancestor
    for (let a = el.parentElement, d = 0; a && a !== document.body && d < 8; a = a.parentElement, d++) {
      let anchor = null;
      if (goodId(a.id)) anchor = '#' + esc(a.id);
      else if (a.getAttribute('data-framer-name')) anchor = a.tagName.toLowerCase() + attrSel('data-framer-name', a.getAttribute('data-framer-name'));
      else if (a.getAttribute('data-testid')) anchor = attrSel('data-testid', a.getAttribute('data-testid'));
      if (!anchor) continue;
      for (const s of (tries.length ? tries : [tag])) {
        const q = anchor + ' ' + s;
        const m = score(q);
        if (m && m.length === 1) return { selector: q, nth: 0, count: 1 };
        if (m && (!best || m.length < best.count)) best = { selector: q, nth: m.indexOf(el), count: m.length };
      }
      break;
    }
    if (best && best.count <= 12) return best;
    // structural path, last resort
    const path = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = n.parentElement;
      const idx = p ? Array.from(p.children).indexOf(n) + 1 : 1;
      path.unshift(`${n.tagName.toLowerCase()}:nth-child(${idx})`);
    }
    const s = 'body > ' + path.join(' > ');
    return { selector: s, nth: 0, count: 1, structural: true };
  }

  /** Find the target again: visible matches of selector (optionally containing text), the nth one. */
  function resolve(loc) {
    const pick = (list) => {
      if (!list || !list.length) return null;
      let l = list;
      if (loc.text) { const t = l.filter((e) => (e.textContent || '').replace(/\s+/g, ' ').includes(loc.text)); if (t.length) l = t; }
      return l[Math.min(loc.nth || 0, l.length - 1)];
    };
    let el = pick(visibleMatches(loc.selector));
    if (!el && loc.name) el = pick(visibleMatches(attrSel('data-framer-name', loc.name)));
    if (!el && loc.text) {
      const all = Array.from(document.querySelectorAll(loc.tag || '*')).filter((e) => visible(e) && (e.textContent || '').replace(/\s+/g, ' ').includes(loc.text));
      // the smallest one whose size class matches is the best guess
      all.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
      el = all[0] || null;
    }
    return el;
  }

  function describe(el) {
    const r = pageRect(el);
    return { tag: el.tagName.toLowerCase(), id: el.id || undefined, name: el.getAttribute('data-framer-name') || undefined, classes: cls(el).filter((c) => !HASHY.test(c)).slice(0, 4).join(' ') || undefined, rect: r, children: el.children.length, descendants: el.querySelectorAll('*').length, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined };
  }

  /** Candidate targets for a query (selector, visible text or framer name), each with its ancestor chain. */
  function candidates(query, max = 6) {
    const hits = new Set();
    const sel = visibleMatches(query);
    if (sel) sel.forEach((e) => hits.add(e));
    for (const e of visibleMatches(attrSel('data-framer-name', query)) || []) hits.add(e);
    const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!sel || !sel.length) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = (n.nodeValue || '').replace(/\s+/g, ' ').toLowerCase();
        if (v.includes(q) && n.parentElement && visible(n.parentElement)) hits.add(n.parentElement);
        if (hits.size > 40) break;
      }
      for (const e of document.querySelectorAll('[aria-label],[alt],[title]')) {
        const v = (e.getAttribute('aria-label') || e.getAttribute('alt') || e.getAttribute('title') || '').toLowerCase();
        if (v.includes(q) && visible(e)) hits.add(e);
      }
    }
    const out = [];
    for (const el of [...hits].slice(0, max)) {
      const chain = [];
      for (let a = el, d = 0; a && a !== document.body && a !== document.documentElement && d < 10; a = a.parentElement, d++) {
        if (!visible(a)) continue;
        chain.push({ up: d, ...describe(a), ...selectorFor(a) });
      }
      out.push({ hit: describe(el), chain });
    }
    return out;
  }

  /** Stamp data-ct-id on the root and every element below it, in document order. */
  function tag(root) {
    let i = 0;
    root.setAttribute('data-ct-id', 'c' + i++);
    for (const e of root.querySelectorAll('*')) e.setAttribute('data-ct-id', 'c' + i++);
    return i;
  }
  const cid = (e) => e.getAttribute && e.getAttribute('data-ct-id');

  function pseudo(el, which) {
    const cs = getComputedStyle(el, which);
    if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') return null;
    const o = {};
    for (const k of LAYOUT_PROPS) { const v = cs[k]; if (v !== undefined && v !== '') o[k] = v; }
    return o;
  }

  /** The subtree: every rendered element with its rect relative to the root and the computed styles that decide it. */
  function layout(root) {
    const R = root.getBoundingClientRect();
    const out = [];
    const walk = (el, depth, parent) => {
      if (SKIP.has(el.tagName)) return;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const shown = cs.display !== 'none';
      const rec = {
        cid: cid(el), parent, depth, tag: el.tagName.toLowerCase(),
        name: el.getAttribute('data-framer-name') || undefined,
        classes: cls(el).join(' ') || undefined,
        text: ownText(el).slice(0, 300) || undefined,
        rect: { x: r2(r.left - R.left), y: r2(r.top - R.top), w: r2(r.width), h: r2(r.height) },
        visible: shown && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        style: {},
      };
      for (const k of LAYOUT_PROPS) { let v = cs[k]; if (v === undefined || v === '') continue; if (k === 'backgroundImage' && v.length > 600) v = v.slice(0, 600) + '...'; rec.style[k] = v; }
      const b = pseudo(el, '::before'), a = pseudo(el, '::after');
      if (b) rec.before = b;
      if (a) rec.after = a;
      if (el.tagName === 'IMG') rec.media = { src: el.getAttribute('src'), currentSrc: el.currentSrc, srcset: el.getAttribute('srcset') || undefined, sizes: el.getAttribute('sizes') || undefined, alt: el.getAttribute('alt') ?? undefined, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, loading: el.getAttribute('loading') || undefined };
      if (el.tagName === 'VIDEO') rec.media = { src: el.currentSrc || el.getAttribute('src'), poster: el.getAttribute('poster') || undefined, autoplay: el.autoplay, loop: el.loop, muted: el.muted, playsInline: el.playsInline, naturalWidth: el.videoWidth, naturalHeight: el.videoHeight };
      if (el.tagName === 'A') rec.href = el.getAttribute('href') || undefined;
      if (el.tagName === 'svg' || el.tagName === 'SVG') rec.svg = { viewBox: el.getAttribute('viewBox') || undefined };
      if (el.getAttribute('data-framer-appear-id')) rec.appearId = el.getAttribute('data-framer-appear-id');
      if (el.getAttribute('aria-expanded') !== null) rec.ariaExpanded = el.getAttribute('aria-expanded');
      out.push(rec);
      if (!shown) return;
      for (const c of el.children) walk(c, depth + 1, rec.cid);
    };
    walk(root, 0, null);
    return out;
  }

  /** Text as painted: one rect per non-empty text node, relative to the root. Wrapper-agnostic, so it compares build to reference fairly. */
  function texts(root) {
    const R = root.getBoundingClientRect();
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || !visible(p)) continue;
      const pcs = getComputedStyle(p);
      if (pcs.opacity === '0') continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const lines = Array.from(range.getClientRects()).filter((x) => x.width > 0).length;
      let loop = false;
      for (let a = p; a && a !== root.parentElement; a = a.parentElement) if (looping(a).size) { loop = true; break; }
      out.push({ ...(loop ? { loop: true } : {}), text: t.slice(0, 200), x: r2(r.left - R.left), y: r2(r.top - R.top), w: r2(r.width), h: r2(r.height), lines, font: `${pcs.fontWeight} ${pcs.fontSize}/${pcs.lineHeight} ${pcs.fontFamily.split(',')[0].replace(/["']/g, '')}`, color: pcs.color, cid: cid(p) || undefined });
    }
    return out;
  }

  /** Replaced / painted media in the subtree, in order: img, svg (top-level only), video, canvas, iframe, picture. */
  function media(root) {
    const R = root.getBoundingClientRect();
    const out = [];
    for (const e of root.querySelectorAll('img, video, canvas, iframe, svg')) {
      if (e.tagName.toLowerCase() === 'svg' && e.parentElement && e.parentElement.closest('svg')) continue;
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      out.push({ kind: e.tagName.toLowerCase(), x: r2(r.left - R.left), y: r2(r.top - R.top), w: r2(r.width), h: r2(r.height), cid: cid(e) || undefined });
    }
    // things an infinite animation keeps moving: masked in pixel diffs, not held to 1px
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (e === root || !visible(e) || !looping(e).size) continue;
      const r = e.getBoundingClientRect();
      const pad = Math.max(r.width, r.height) * 0.15;
      out.push({ kind: 'loop', x: r2(r.left - R.left - pad), y: r2(r.top - R.top - pad), w: r2(r.width + 2 * pad), h: r2(r.height + 2 * pad), cid: cid(e) || undefined });
    }
    return out;
  }

  /** What the root inherits and sits in: ancestor chain, inherited type, the backdrop, css vars in scope. */
  function context(root, varNames = []) {
    const p = root.parentElement || document.body;
    const pcs = getComputedStyle(p);
    const inherited = {};
    for (const k of INHERITED) inherited[k] = pcs[k];
    // computed line-height is resolved to px, but a unitless one inherits as a ratio: probe which it is
    try {
      const probe = document.createElement('span');
      probe.style.cssText = 'font-size:100px;position:absolute;visibility:hidden';
      p.appendChild(probe);
      const lh = getComputedStyle(probe).lineHeight;
      probe.remove();
      if (lh === 'normal') inherited.lineHeight = 'normal';
      else if (Math.abs(parseFloat(lh) - parseFloat(pcs.lineHeight)) > 0.01) inherited.lineHeight = String(Math.round(parseFloat(lh) * 1000) / 100000);
    } catch {}
    let backdrop = null;
    for (let a = root; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const bg = cs.backgroundColor;
      if ((bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (cs.backgroundImage && cs.backgroundImage !== 'none')) {
        backdrop = { from: a === root ? 'root' : 'ancestor', tag: a.tagName.toLowerCase(), backgroundColor: bg, backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 400) : undefined };
        if (a !== root) break;
        if (bg && bg !== 'rgba(0, 0, 0, 0)') break;
      }
    }
    if (!backdrop || backdrop.from === 'root') {
      const html = getComputedStyle(document.documentElement).backgroundColor;
      const body = getComputedStyle(document.body).backgroundColor;
      const pageBg = body !== 'rgba(0, 0, 0, 0)' ? body : html !== 'rgba(0, 0, 0, 0)' ? html : 'rgb(255, 255, 255)';
      backdrop = { ...(backdrop || {}), page: pageBg };
    }
    const ancestors = [];
    for (let a = root.parentElement, d = 1; a && d <= 6; a = a.parentElement, d++) {
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      ancestors.push({ up: d, tag: a.tagName.toLowerCase(), name: a.getAttribute('data-framer-name') || undefined, rect: { x: r2(r.left + scrollX), y: r2(r.top + scrollY), w: r2(r.width), h: r2(r.height) }, display: cs.display, flexDirection: cs.flexDirection, alignItems: cs.alignItems, justifyContent: cs.justifyContent, gap: cs.gap, gridTemplateColumns: cs.display.includes('grid') ? cs.gridTemplateColumns : undefined, padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, maxWidth: cs.maxWidth, width: cs.width, position: cs.position, overflow: cs.overflow });
      if (a === document.body) break;
    }
    // the attributes selectors can hang off: rules like `.page .card` or `[data-theme] .x` need them in a snapshot
    const chain = [];
    for (let a = root.parentElement; a; a = a.parentElement) {
      const attrs = {};
      for (const at of a.attributes) {
        const n = at.name;
        if (n === 'style' || n.startsWith('on') || n === 'src' || n === 'href' || n === 'srcset' || n.startsWith('data-ct')) continue;
        if (n === 'class' || n === 'id' || n.startsWith('data-') || n === 'lang' || n === 'dir' || n === 'role' || n === 'open' || n === 'type') attrs[n] = at.value.slice(0, 300);
      }
      chain.unshift({ tag: a.tagName.toLowerCase(), attrs });
    }
    const rcs = getComputedStyle(root);
    const vars = {};
    for (const v of varNames) { const val = rcs.getPropertyValue(v).trim(); if (val) vars[v] = val; }
    const R = root.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: { rect: pageRect(root), position: rcs.position, display: rcs.display, margin: `${rcs.marginTop} ${rcs.marginRight} ${rcs.marginBottom} ${rcs.marginLeft}`, boxSizing: rcs.boxSizing, flex: `${rcs.flexGrow} ${rcs.flexShrink} ${rcs.flexBasis}`, alignSelf: rcs.alignSelf, zIndex: rcs.zIndex, inViewportAtLoad: R.top + scrollY < innerHeight },
      parentContentWidth: r2(p.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight)),
      inherited, backdrop, ancestors, chain, vars,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
  }

  /** Does the root's height come from its context (stretch, flex grow, grid track)? Try it without that context and see. */
  function heightFromContext(root) {
    const h0 = root.getBoundingClientRect().height;
    const w0 = root.getBoundingClientRect().width;
    const prev = root.getAttribute('style');
    root.style.setProperty('align-self', 'flex-start', 'important');
    root.style.setProperty('justify-self', 'start', 'important');
    root.style.setProperty('flex', '0 0 auto', 'important');
    root.style.setProperty('width', w0 + 'px', 'important');
    root.style.setProperty('box-sizing', 'border-box', 'important');
    const h1 = root.getBoundingClientRect().height;
    if (prev === null) root.removeAttribute('style'); else root.setAttribute('style', prev);
    return { natural: r2(h1), actual: r2(h0), fromContext: Math.abs(h1 - h0) > 0.5 };
  }

  /** Pin the root's border box so the component is measured in isolation from wherever it was placed. */
  function pin(root, w, h) {
    if (!root.hasAttribute('data-ct-prepin')) root.setAttribute('data-ct-prepin', root.getAttribute('style') || '');
    for (const k of ['width', 'min-width', 'max-width']) root.style.setProperty(k, w + 'px', 'important');
    root.style.setProperty('box-sizing', 'border-box', 'important');
    root.style.setProperty('flex', '0 0 auto', 'important');
    if (h) for (const k of ['height', 'min-height', 'max-height']) root.style.setProperty(k, h + 'px', 'important');
    return root.getBoundingClientRect().width;
  }

  /** Interactive targets inside the component (and the root itself): what to hover, press, focus, click. */
  function interactive(root, max = 10) {
    const R = root.getBoundingClientRect();
    const out = [];
    const seen = new Set();
    const cands = [root, ...root.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [aria-expanded], [aria-haspopup], summary, label, input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    // anything with a pointer cursor that is not inside another candidate
    for (const e of root.querySelectorAll('*')) {
      if (getComputedStyle(e).cursor === 'pointer' && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer')) cands.push(e);
    }
    for (const el of cands) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const isRoot = el === root;
      const tagn = el.tagName.toLowerCase();
      const clickable = /^(a|button|summary|label|input|select|textarea)$/.test(tagn) || el.hasAttribute('role') || el.hasAttribute('aria-expanded') || cs.cursor === 'pointer';
      if (isRoot && !clickable) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const toggles = el.hasAttribute('aria-expanded') || tagn === 'summary' || /accordion|toggle|trigger|faq|question|tab|switch|disclosure|collapse/i.test((el.getAttribute('data-framer-name') || '') + ' ' + cls(el).join(' ') + ' ' + (el.getAttribute('role') || ''));
      const form = /^(input|select|textarea)$/.test(tagn);
      const kind = form ? 'field' : toggles ? 'toggle' : tagn === 'a' ? 'link' : tagn === 'button' || el.getAttribute('role') === 'button' ? 'button' : isRoot ? 'root' : 'pointer';
      const key = kind + '|' + text + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cid: cid(el), kind, tag: tagn, text: text || undefined, name: el.getAttribute('data-framer-name') || undefined, rect: { x: r2(r.left - R.left), y: r2(r.top - R.top), w: r2(r.width), h: r2(r.height) }, click: toggles, focusable: form || tagn === 'a' || tagn === 'button' || el.tabIndex >= 0 });
    }
    const rank = { root: 0, button: 1, toggle: 2, link: 3, field: 4, pointer: 5 };
    out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    return out.slice(0, max);
  }

  /** Computed state of every element in the subtree, for before / after diffs. Pseudo elements included. */
  /** Properties an infinite animation on el keeps moving: they are the loop, not the state, so diffs skip them. */
  function looping(el) {
    const out = new Set();
    let list = [];
    try { list = el.getAnimations(); } catch {}
    for (const a of list) {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
      if (!t || t.iterations !== Infinity) continue;
      if (a.transitionProperty) continue;
      try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) out.add(p === 'cssFloat' ? 'float' : p); } catch {}
      if (out.has('transform')) { out.add('scale'); out.add('rotate'); out.add('translate'); }
    }
    return out;
  }
  function snap(root) {
    const m = {};
    const one = (key, cs, skip) => { const o = {}; for (const k of STATE_PROPS) o[k] = skip && skip.has(k) ? '(loop)' : cs[k]; m[key] = o; };
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const id = cid(el);
      if (!id) continue;
      const loop = looping(el);
      one(id, getComputedStyle(el), loop);
      for (const p of ['::before', '::after']) { const cs = getComputedStyle(el, p); if (cs.content && cs.content !== 'none' && cs.content !== 'normal') one(id + p, cs); }
      const r = el.getBoundingClientRect();
      m[id].__rect = loop.size ? '(loop)' : `${r2(r.width)}x${r2(r.height)}`;
    }
    return m;
  }
  function diffSnap(a, b) {
    const out = [];
    for (const k of Object.keys(b)) {
      if (!a[k]) { out.push({ cid: k, prop: '(appeared)', from: null, to: 'present' }); continue; }
      for (const p of Object.keys(b[k])) if (a[k][p] !== b[k][p]) out.push({ cid: k, prop: p, from: a[k][p], to: b[k][p] });
    }
    for (const k of Object.keys(a)) if (!b[k]) out.push({ cid: k, prop: '(gone)', from: 'present', to: null });
    return out;
  }
  function transitionsOf(root, cids) {
    const out = {};
    for (const id of cids) {
      const el = id === cid(root) ? root : root.querySelector(`[data-ct-id="${id.replace(/::.*$/, '')}"]`);
      if (!el) continue;
      const cs = getComputedStyle(el, id.includes('::') ? id.slice(id.indexOf('::')) : null);
      if (cs.transitionDuration && cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) out[id] = `${cs.transitionProperty} | ${cs.transitionDuration} | ${cs.transitionTimingFunction} | ${cs.transitionDelay}`;
    }
    return out;
  }

  /** Every running animation in the subtree (CSS animations, transitions, WAAPI incl. motion / Framer appears), with keyframes and timing. */
  function animations(root) {
    let list = [];
    try { list = root.getAnimations({ subtree: true }); } catch { return []; }
    return list.map((a) => {
      const eff = a.effect;
      const target = eff && eff.target;
      let kf = [];
      try { kf = eff.getKeyframes().map((k) => { const o = {}; for (const [p, v] of Object.entries(k)) if (v !== null && v !== undefined && p !== 'computedOffset') o[p] = v; return o; }); } catch {}
      let timing = {};
      try { const t = eff.getTiming(); timing = { duration: t.duration, delay: t.delay, endDelay: t.endDelay, easing: t.easing, iterations: t.iterations === Infinity ? 'Infinity' : t.iterations, direction: t.direction, fill: t.fill }; } catch {}
      return { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || undefined, target: target ? (cid(target) || target.tagName.toLowerCase()) + (eff.pseudoElement || '') : null, playState: a.playState, currentTime: a.currentTime, keyframes: kf.slice(0, 40), timing };
    });
  }

  /** Urls the subtree paints with, and the font families it uses. */
  function refs(root) {
    const urls = new Set();
    const addCss = (v) => { if (!v || v === 'none') return; for (const m of v.matchAll(/url\((['"]?)(.*?)\1\)/g)) if (!m[2].startsWith('data:') && !m[2].startsWith('#')) urls.add(new URL(m[2], location.href).href); };
    const addSrcset = (v) => { if (!v) return; for (const part of v.split(/,\s+(?=\S)/)) { const u = part.trim().split(/\s+/)[0]; if (u && !u.startsWith('data:')) urls.add(new URL(u, location.href).href); } };
    const fonts = new Set();
    const els = [root, ...root.querySelectorAll('*')];
    for (const el of els) {
      const cs = getComputedStyle(el);
      for (const p of ['backgroundImage', 'maskImage', 'WebkitMaskImage', 'listStyleImage', 'borderImageSource', 'content', 'cursor']) addCss(cs[p]);
      for (const ps of ['::before', '::after']) { const c = getComputedStyle(el, ps); if (c.content !== 'none') { addCss(c.backgroundImage); addCss(c.maskImage); addCss(c.content); fonts.add(c.fontFamily); } }
      if (ownText(el) || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') fonts.add(cs.fontFamily);
      const t = el.tagName;
      if (t === 'IMG') { if (el.currentSrc && !el.currentSrc.startsWith('data:')) urls.add(el.currentSrc); const s = el.getAttribute('src'); if (s && !s.startsWith('data:')) urls.add(new URL(s, location.href).href); addSrcset(el.getAttribute('srcset')); }
      if (t === 'SOURCE') { const s = el.getAttribute('src'); if (s) urls.add(new URL(s, location.href).href); addSrcset(el.getAttribute('srcset')); }
      if (t === 'VIDEO') { if (el.currentSrc) urls.add(el.currentSrc); const s = el.getAttribute('src'); if (s) urls.add(new URL(s, location.href).href); if (el.getAttribute('poster')) urls.add(new URL(el.getAttribute('poster'), location.href).href); }
      if (t === 'image' || t === 'IMAGE') { const h = el.getAttribute('href') || el.getAttribute('xlink:href'); if (h && !h.startsWith('data:')) urls.add(new URL(h, location.href).href); }
      if (t === 'use' || t === 'USE') { const h = el.getAttribute('href') || el.getAttribute('xlink:href'); if (h && !h.startsWith('#') && !h.startsWith('data:')) urls.add(new URL(h.split('#')[0], location.href).href); }
      if (t === 'INPUT' && el.getAttribute('type') === 'image' && el.getAttribute('src')) urls.add(new URL(el.getAttribute('src'), location.href).href);
    }
    const families = new Set();
    for (const f of fonts) for (const part of (f || '').split(',')) { const n = part.trim().replace(/^["']|["']$/g, ''); if (n) families.add(n); }
    return { urls: [...urls].filter((u) => /^https?:/.test(u)), families: [...families] };
  }

  /** In-document svg symbols the subtree references with <use href="#id">: they live outside the component, so bring them along. */
  function symbols(root) {
    const ids = new Set();
    for (const u of root.querySelectorAll('use')) { const h = u.getAttribute('href') || u.getAttribute('xlink:href') || ''; if (h.startsWith('#')) ids.add(h.slice(1)); }
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(e);
      for (const v of [cs.clipPath, cs.maskImage, cs.filter, e.getAttribute('fill'), e.getAttribute('stroke'), e.getAttribute('mask'), e.getAttribute('clip-path'), e.getAttribute('filter')]) {
        for (const m of String(v || '').matchAll(/url\(["']?#([^"')]+)["']?\)/g)) ids.add(m[1]);
      }
    }
    const out = [];
    for (const id of ids) {
      const d = document.getElementById(id);
      if (d && !root.contains(d)) out.push({ id, html: d.outerHTML });
    }
    return out;
  }

  const hidden = [];
  /** Hide fixed / sticky things that are not the component and not around it, so they do not paint over the shot. */
  function hideOverlays(root) {
    let n = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (e === root || root.contains(e) || e.contains(root)) continue;
      const cs = getComputedStyle(e);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.visibility !== 'hidden' && cs.display !== 'none') {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        hidden.push([e, e.style.visibility]);
        e.style.setProperty('visibility', 'hidden', 'important');
        n++;
      }
    }
    return n;
  }
  function restoreOverlays() { while (hidden.length) { const [e, v] = hidden.pop(); e.style.visibility = v; } }

  /** Clean outerHTML of the root: scripts out, runtime ids kept, lazy media made eager with the url that actually loaded. */
  function html(root) {
    const c = root.cloneNode(true);
    for (const s of c.querySelectorAll('script, noscript, template[shadowroot]')) s.remove();
    const liveImgs = [root, ...root.querySelectorAll('*')].filter((e) => e.tagName === 'IMG');
    const cloneImgs = [c, ...c.querySelectorAll('*')].filter((e) => e.tagName === 'IMG');
    cloneImgs.forEach((img, i) => { const live = liveImgs[i]; if (live && live.currentSrc) img.setAttribute('data-ct-current', live.currentSrc); img.removeAttribute('loading'); });
    return c.outerHTML;
  }

  /**
   * Origin blackout applied to the live component before anything is measured: text nodes and the attributes
   * people read (alt, aria-label, title, placeholder, value) get the brand in place of origin words, keeping
   * case shape. The reference then shows the component as it will read in the clone, and its screenshots
   * stop saying where it came from.
   */
  function rebrand(root, sources, brand) {
    if (!root || !sources.length) return 0;
    const res = sources.map((s) => new RegExp(s, 'g'));
    const shape = (m) => (m.length > 1 && m === m.toUpperCase() ? brand.toUpperCase() : m[0] === m[0].toUpperCase() ? brand[0].toUpperCase() + brand.slice(1) : brand.toLowerCase());
    const fix = (v) => { let o = v; for (const re of res) o = o.replace(re, (m) => shape(m)); return o; };
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { const v = t.nodeValue || ''; const w = fix(v); if (w !== v) { t.nodeValue = w; n++; } }
    for (const e of [root, ...root.querySelectorAll('*')]) for (const k of ['alt', 'aria-label', 'title', 'placeholder', 'value']) { const v = e.getAttribute(k); if (v) { const w = fix(v); if (w !== v) { e.setAttribute(k, w); n++; } } }
    return n;
  }

  function scrollToRoot(root, where = 'center') {
    const r = root.getBoundingClientRect();
    const y = r.top + scrollY;
    const target = where === 'top' ? y - 24 : y + r.height / 2 - innerHeight / 2;
    window.scrollTo(0, Math.max(0, target));
    return scrollY;
  }

  window.__ct = { rebrand, visible, visibleMatches, selectorFor, resolve, describe, candidates, tag, layout, texts, media, context, heightFromContext, pin, interactive, snap, diffSnap, transitionsOf, animations, refs, symbols, hideOverlays, restoreOverlays, html, scrollToRoot, pageRect, kebab };
})();
