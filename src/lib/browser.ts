/**
 * Shared browser helpers. Every command that opens a page goes through here so the
 * reference capture and the build screenshots are taken under identical conditions
 * (same UA, same DSF, reducedMotion off, same reveal + stitch logic).
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

/** Framer breakpoints: desktop >=1200, tablet 810..1199, phone <810. 1024 and 810 both land in tablet; generic sites are sampled at the same four widths. */
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'tablet-810', width: 810, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
export type Viewport = { name: string; width: number; height: number };

export function viewportByWidth(w: number): Viewport {
  return VIEWPORTS.find((v) => v.width === w) ?? { name: `w${w}`, width: w, height: w < 600 ? 844 : 900 };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve after `ms` even if the promise never settles (Playwright's close / body calls can hang on a dying target). */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'op'): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((r) => { timer = setTimeout(() => { log(`  ${label} timed out after ${ms}ms, continuing`); r(undefined); }, ms); });
  return Promise.race([p.catch(() => undefined as T | undefined), deadline]).finally(() => { if (timer) clearTimeout(timer); });
}

/** context.close() that cannot hang the run. */
export async function closeCtx(ctx: BrowserContext, ms = 15_000) {
  await withTimeout(ctx.close(), ms, 'context.close');
}
export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

export async function launch(headless = true): Promise<Browser> {
  const b = await chromium.launch({ headless, args: ['--disable-blink-features=AutomationControlled'] });
  b.on('disconnected', () => log('  browser disconnected'));
  return b;
}

/**
 * A browser that is relaunched when it dies. Under memory pressure Chromium can be killed and
 * Playwright (on bun) does not always surface it; pending calls then hang forever. Every long job
 * takes its browser from here and wraps each unit of work in `guard`, resetting the pool on timeout.
 */
export class BrowserPool {
  private b: Browser | null = null;
  constructor(private headless = true) {}
  async get(): Promise<Browser> {
    if (!this.b || !this.b.isConnected()) {
      if (this.b) log('  browser gone, relaunching');
      this.b = await launch(this.headless);
    }
    return this.b;
  }
  async reset() {
    if (this.b) await withTimeout(this.b.close(), 5_000, 'browser.close');
    this.b = null;
  }
  async close() {
    await this.reset();
  }
}

/** Run one unit of work with a deadline. Returns ok:false (and the reason) instead of hanging or throwing. */
export type GuardResult = { ok: boolean; reason?: string; timedOut?: boolean };
export async function guard(label: string, ms: number, fn: () => Promise<unknown>): Promise<GuardResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race<GuardResult>([
      fn().then((): GuardResult => ({ ok: true })).catch((e: any): GuardResult => ({ ok: false, reason: e?.message || String(e) })),
      new Promise<GuardResult>((r) => { timer = setTimeout(() => r({ ok: false, reason: `${label} exceeded ${Math.round(ms / 1000)}s`, timedOut: true }), ms); }),
    ]);
    if (!res.ok) log(`  ${label}: ${res.reason}`);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function newCtx(browser: Browser, vp: { width: number; height: number }, dsf = 2): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: dsf,
    userAgent: UA,
    reducedMotion: 'no-preference',
    colorScheme: 'light',
    locale: 'en-US',
  });
}

/** Navigate, wait for network idle plus a settle for preloaders / hero appears, disable CSS smooth scroll. */
export async function load(page: Page, url: string, settleMs = 2500) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(async () => {
    log('  networkidle timeout, falling back to domcontentloaded');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);
  });
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
  });
}

/** Elements that carry an appear id but never reached opacity ~1 (means the reveal pass missed them). */
export const UNREVEALED_JS = `(() => {
  const out = [];
  for (const e of document.querySelectorAll('[data-framer-appear-id]')) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const op = parseFloat(cs.opacity);
    if (op < 0.9) out.push({ appearId: e.getAttribute('data-framer-appear-id'), name: e.getAttribute('data-framer-name'), tag: e.tagName.toLowerCase(), opacity: op, transform: cs.transform, y: Math.round(r.top + scrollY), h: Math.round(r.height), inlineStyle: (e.getAttribute('style')||'').slice(0,200) });
  }
  return out;
})()`;

/** Scroll top to bottom in steps so in-view observers fire. Wheel mode cooperates with Lenis. */
export async function revealPass(page: Page, useWheel: boolean, step = 250, waitMs = 120) {
  let y = 0;
  let steps = 0;
  if (useWheel) await page.mouse.move(10, 10);
  while (true) {
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    if (y > docH) break;
    if (useWheel) await page.mouse.wheel(0, step);
    else await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(waitMs);
    y += step;
    if (++steps > 4000) break;
  }
  await page.waitForTimeout(1000);
  await scrollTop(page, useWheel);
}

export async function scrollTop(page: Page, useWheel: boolean) {
  if (useWheel) {
    for (let i = 0; i < 400; i++) {
      await page.mouse.wheel(0, -3000);
      await page.waitForTimeout(40);
      const y = await page.evaluate(() => window.scrollY);
      if (y <= 0) break;
    }
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(500);
}

/** Reveal everything: detect whether scrollTo sticks (Lenis resets it), fall back to wheel, then scrollIntoView stragglers. */
export async function reveal(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(150);
  const stuck = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrollToWorks = stuck > 300;
  await revealPass(page, !scrollToWorks);
  let unrevealed = (await page.evaluate(UNREVEALED_JS)) as any[];
  let method = scrollToWorks ? 'scrollTo' : 'wheel';
  if (unrevealed.length) {
    await revealPass(page, true);
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('[data-framer-appear-id]')) {
        if (parseFloat(getComputedStyle(e).opacity) < 0.9) e.scrollIntoView({ block: 'center' });
      }
    });
    await page.waitForTimeout(1200);
    await scrollTop(page, true);
    unrevealed = (await page.evaluate(UNREVEALED_JS)) as any[];
    method += '+wheel+scrollIntoView';
  }
  return { unrevealed, method, scrollToWorks };
}

export const HIDE_FIXED_JS = `(() => {
  let n = 0;
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' && cs.visibility !== 'hidden' && cs.display !== 'none') {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      e.setAttribute('data-rig-hidden', e.style.visibility || ''); e.style.visibility = 'hidden'; n++;
    }
  }
  return n;
})()`;
export const RESTORE_FIXED_JS = `(() => { for (const e of document.querySelectorAll('[data-rig-hidden]')) { e.style.visibility = e.getAttribute('data-rig-hidden'); e.removeAttribute('data-rig-hidden'); } })()`;

/**
 * Full page as scroll-and-stitch. Chromium's captureBeyondViewport resizes the viewport to the
 * document height, which re-lays-out vh sections and fires IntersectionObservers (a 13573px page
 * measured 10900 that way). Real viewport chunks stitched together are the truth; fixed elements
 * are hidden after the first chunk, like Chrome's own full-page capture.
 */
export async function stitchFullPage(page: Page, vpW: number, vpH: number, file: string, dsf: number, opts: { chunkWaitMs?: number; wheelNudge?: boolean; background?: string } = {}) {
  const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const parts: { buf: Buffer; top: number }[] = [];
  let hiddenFixed = 0;
  const wait = opts.chunkWaitMs ?? 250;
  for (let y = 0; y < docH; y += vpH) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    if (opts.wheelNudge) {
      await page.mouse.move(vpW / 2, 10);
      await page.mouse.wheel(0, 1);
    }
    await page.waitForTimeout(y === 0 ? Math.max(400, wait) : wait);
    const actual = await page.evaluate(() => scrollY);
    if (y > 0 && !hiddenFixed) {
      hiddenFixed = (await page.evaluate(HIDE_FIXED_JS)) as number;
      await page.waitForTimeout(50);
    }
    const buf = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
    parts.push({ buf, top: Math.round(actual * dsf) });
  }
  await page.evaluate(RESTORE_FIXED_JS);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const W = Math.round(vpW * dsf);
  const H = Math.round(docH * dsf);
  const comps: sharp.OverlayOptions[] = [];
  for (const p of parts) {
    const ph = Math.round(vpH * dsf);
    if (p.top + ph > H) {
      const keep = H - p.top;
      if (keep <= 0) continue;
      comps.push({ input: await sharp(p.buf).extract({ left: 0, top: 0, width: W, height: keep }).png().toBuffer(), top: p.top, left: 0 });
    } else comps.push({ input: p.buf, top: p.top, left: 0 });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: opts.background ?? '#ffffff' } })
    .composite(comps)
    .png()
    .toFile(file);
  return { docH, chunks: parts.length, hiddenFixed };
}

export async function cropFromFull(fullFile: string, clip: { x: number; y: number; width: number; height: number }, file: string, dsf: number) {
  const meta = await sharp(fullFile).metadata();
  const left = Math.max(0, Math.round(clip.x * dsf));
  const top = Math.max(0, Math.round(clip.y * dsf));
  const width = Math.min(meta.width! - left, Math.round(clip.width * dsf));
  const height = Math.min(meta.height! - top, Math.round(clip.height * dsf));
  if (width <= 0 || height <= 0) throw new Error(`crop outside image: ${JSON.stringify(clip)}`);
  await sharp(fullFile).extract({ left, top, width, height }).png().toFile(file);
}
