/**
 * Readable tree of a component's html: one line per element with its data-ct-id, layer name, classes, the
 * layout-relevant part of its inline style and its own text. The spec (spec/component.txt) puts this on top
 * of the css so a builder can go from an element to every rule that styles it.
 */
import { parse, HTMLElement, Node, NodeType } from 'node-html-parser';

const KEEP = ['position', 'display', 'width', 'height', 'min-', 'max-', 'top', 'left', 'right', 'bottom', 'inset', 'opacity', 'transform', 'background', 'border', 'outline', 'gap', 'padding', 'margin', 'flex', 'grid', 'align', 'justify', 'place', 'z-index', 'overflow', 'aspect-ratio', 'object-', 'filter', 'backdrop', 'box-shadow', 'font', 'line-height', 'letter-spacing', 'text-', 'white-space', 'color', 'mix-blend', 'mask', 'clip', 'perspective', 'transform-style', 'transition', 'animation', '--'];

function decode(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function fmtStyle(st: string) {
  return decode(st).split(';').map((x) => x.trim()).filter(Boolean).filter((x) => KEEP.some((k) => x.startsWith(k))).join('; ').slice(0, 500);
}

export function treeLines(html: string): string[] {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });
  const out: string[] = [];
  const walk = (n: Node, depth: number) => {
    if (n.nodeType !== NodeType.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = el.rawTagName?.toLowerCase();
    if (!tag || ['script', 'style', 'noscript'].includes(tag)) return;
    const a = el.attributes;
    const bits = [tag];
    if (a['data-ct-id']) bits.push('@' + a['data-ct-id']);
    if (a['data-framer-name']) bits.push(`[${a['data-framer-name']}]`);
    if (a['data-framer-appear-id']) bits.push('appear=' + a['data-framer-appear-id']);
    if (a.id) bits.push('#' + a.id);
    const cls = (a.class || '').split(/\s+/).filter(Boolean).join('.');
    if (cls) bits.push('.' + (cls.length > 140 ? cls.slice(0, 140) + '...' : cls));
    for (const k of ['role', 'aria-label', 'aria-expanded', 'type', 'name', 'placeholder', 'alt', 'for', 'tabindex']) if (a[k] !== undefined) bits.push(`${k}="${a[k].slice(0, 60)}"`);
    if (tag === 'img') bits.push('src=' + (a.src || '').slice(0, 90) + (a.srcset ? ' +srcset' : '') + (a.sizes ? ` sizes="${a.sizes.slice(0, 40)}"` : ''));
    if (tag === 'video' || tag === 'source') bits.push('src=' + (a.src || '').slice(0, 90) + (a.autoplay !== undefined ? ' autoplay' : '') + (a.loop !== undefined ? ' loop' : '') + (a.muted !== undefined ? ' muted' : ''));
    if (tag === 'a') bits.push('href=' + (a.href || ''));
    if (tag === 'svg') bits.push('viewBox=' + (a.viewBox || a.viewbox || ''));
    if (tag === 'use' || tag === 'image') bits.push('href=' + (a.href || a['xlink:href'] || ''));
    if (tag === 'path' && a.d) bits.push(`d=${a.d.length > 60 ? a.d.slice(0, 60) + '...' : a.d}`);
    if (a['data-border']) bits.push('data-border');
    const st = fmtStyle(a.style || '');
    if (st) bits.push('{' + st + '}');
    const own = el.childNodes.filter((c) => c.nodeType === NodeType.TEXT_NODE).map((c) => decode(c.rawText).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    if (own) bits.push('"' + own.slice(0, 200) + '"');
    out.push('  '.repeat(depth) + bits.join(' '));
    // svg internals past the first level are noise for a tree; the html has them
    if (tag === 'svg') { const kids = el.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE); if (kids.length > 6) { out.push('  '.repeat(depth + 1) + `(${kids.length} svg children, see dom/component.html)`); return; } }
    for (const c of el.childNodes) walk(c, depth + 1);
  };
  for (const c of root.childNodes) walk(c, 0);
  return out;
}
