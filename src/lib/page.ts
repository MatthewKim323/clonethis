/**
 * Glue between Node and the in-page library (src/page/ct.js). Every command that measures a component,
 * reference or build, goes through `ct(page, ...)` so both sides run the same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

const LIB = fs.readFileSync(path.join(import.meta.dirname, '..', 'page', 'ct.js'), 'utf8');

export type Locator = { selector: string; nth?: number; text?: string; name?: string; tag?: string };
export type Rect = { x: number; y: number; w: number; h: number };

export async function ensureLib(page: Page) {
  const has = await page.evaluate(() => !!(window as any).__ct).catch(() => false);
  if (!has) await page.evaluate(LIB);
}

/** Call a `window.__ct` function with JSON args. The root is re-resolved from `[data-ct-root]` each time. */
export async function ct<T = any>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  await ensureLib(page);
  return page.evaluate(
    ({ fn, args }) => {
      const c = (window as any).__ct;
      const root = document.querySelector('[data-ct-root]');
      const resolved = args.map((a: any) => (a === '$root' ? root : a));
      return c[fn](...resolved);
    },
    { fn, args },
  ) as Promise<T>;
}

/** Resolve the locator, mark the element `data-ct-root`, return its page rect (null if not found). */
export async function markRoot(page: Page, loc: Locator): Promise<Rect | null> {
  await ensureLib(page);
  return page.evaluate((loc) => {
    for (const e of document.querySelectorAll('[data-ct-root]')) e.removeAttribute('data-ct-root');
    const c = (window as any).__ct;
    const el = c.resolve(loc);
    if (!el) return null;
    el.setAttribute('data-ct-root', '');
    return c.pageRect(el);
  }, loc);
}

export async function rootRect(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-ct-root]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const q = (n: number) => Math.round(n * 100) / 100;
    return { x: q(r.left + scrollX), y: q(r.top + scrollY), w: q(r.width), h: q(r.height) };
  });
}

/** Viewport-relative rect of the root after scrolling it into place. */
export async function viewportRect(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-ct-root]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

/** Regex sources for the origin tokens, for `rebrand` in the page (same matcher the blackout scanner uses). */
let REBRAND: { sources: string[]; brand: string } | null = null;
export function setRebrand(tokens: string[], brand: string, tokenRe: (t: string) => RegExp) {
  REBRAND = tokens.length ? { sources: tokens.map((t) => tokenRe(t).source), brand } : null;
}
/** markRoot, then rewrite origin words inside the component to the brand (when a rebrand is set). */
export async function markAndRebrand(page: Page, loc: Locator): Promise<Rect | null> {
  const r = await markRoot(page, loc);
  if (r && REBRAND) {
    await page.evaluate(({ sources, brand }) => (window as any).__ct.rebrand(document.querySelector('[data-ct-root]'), sources, brand), REBRAND);
    return rootRect(page);
  }
  return r;
}

/** Move the pointer to a viewport corner that is not over the component, so no shot is taken mid-hover. */
export async function parkMouse(page: Page) {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const r = await viewportRect(page);
  const corners = [[vp.width - 2, vp.height - 2], [2, vp.height - 2], [vp.width - 2, 2], [2, 2]];
  const free = corners.find(([x, y]) => !r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) ?? corners[0];
  await page.mouse.move(free[0], free[1]);
}
