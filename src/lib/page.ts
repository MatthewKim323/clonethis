/**
 * Glue between Node and the in-page library (src/page/ct.js). Every command that measures a component,
 * reference or build, goes through `ct(page, ...)` so both sides run the same code.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

const LIB = fs.readFileSync(path.join(import.meta.dir, '..', 'page', 'ct.js'), 'utf8');

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
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
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
