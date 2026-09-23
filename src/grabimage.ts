/**
 * grab-image: a component from screenshots alone (a design export, a shot of an app, a site you cannot load).
 *   clonethis grab-image <shot.png> [<shot-390.png> ...] --as name [--vp 1440,390] [--dsf 2 | --css-width 341,358]
 *                        [--no-trim] [--trim-threshold 48] [--brand Name] [--tokens a,b]
 *
 * There is no DOM and no CSS to read, so the reference is what can be measured off the pixels, per image:
 *   capture/<vp>/component.png   the screenshot, margins trimmed, normalized to 2x
 *   capture/<vp>/ocr.json        every line of text with its ink box in css px (Apple Vision; macOS)
 *   capture/<vp>/palette.json    dominant colors with their share of the area, and the background
 *   capture/<vp>/bands.json      rows of content separated by background, and the columns inside each row:
 *                                the vertical rhythm (paddings, gaps) in css px
 *   capture/<vp>/context.json    size in css px (what verify pins and checks)
 * `verify` on an image reference checks the root size, that every OCR'd line is present in the build, and the
 * pixel diff (gate 6% by default). One image per width; `--vp` says which width each one is (default 1440,
 * then 390). `--dsf` is the screenshot's pixel ratio (2 for a Retina screenshot); `--css-width` sets it per image.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Args, usage } from './lib/args.ts';
import { log, viewportByWidth } from './lib/browser.ts';
import { ocr, ocrAvailable } from './lib/ocr.ts';
import { brandFor, neutralComponentName, scrub, writeOrigin } from './lib/anon.ts';

type RGB = [number, number, number];
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const dist = (a: RGB, b: RGB) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

async function raw(file: string) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, at: (x: number, y: number): RGB => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; } };
}

/**
 * The component's own background: the most common color on a ring a few px inside the edge (the edge itself is
 * often a border or outline, and after the trim there is no page left around it).
 */
function borderColor(img: Awaited<ReturnType<typeof raw>>, inset: number): RGB {
  const counts = new Map<string, { c: RGB; n: number }>();
  const add = (c: RGB) => { const k = c.map((v) => v >> 2).join(','); const e = counts.get(k); if (e) e.n++; else counts.set(k, { c, n: 1 }); };
  const i = Math.max(0, Math.min(inset, Math.floor(Math.min(img.W, img.H) / 4)));
  for (let x = i; x < img.W - i; x++) { add(img.at(x, i)); add(img.at(x, img.H - 1 - i)); }
  for (let y = i; y < img.H - i; y++) { add(img.at(i, y)); add(img.at(img.W - 1 - i, y)); }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].c;
}

async function palette(file: string, k = 12) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).resize(96, 96, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { sum: RGB; n: number }>();
  for (let i = 0; i < data.length; i += 3) {
    const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    const b = buckets.get(key) ?? { sum: [0, 0, 0] as RGB, n: 0 };
    b.sum[0] += data[i]; b.sum[1] += data[i + 1]; b.sum[2] += data[i + 2]; b.n++;
    buckets.set(key, b);
  }
  const total = info.width * info.height;
  const merged: { c: RGB; n: number }[] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const c: RGB = [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n];
    const near = merged.find((m) => dist(m.c, c) <= 12);
    if (near) { near.c = near.c.map((v, i) => (v * near.n + c[i] * b.n) / (near.n + b.n)) as RGB; near.n += b.n; } else merged.push({ c, n: b.n });
  }
  return merged.sort((a, b) => b.n - a.n).slice(0, k).map((m) => ({ color: hex(m.c), rgb: `rgb(${m.c.map(Math.round).join(', ')})`, share: +(m.n / total).toFixed(4) }));
}

/** Runs of rows (then columns inside each run) that hold something other than the background. */
function bands(img: Awaited<ReturnType<typeof raw>>, bg: RGB, scale: number) {
  const TH = 18;
  // a border or outline runs down both sides of every row: leave the outer edges out of the row profile
  const edge = Math.min(Math.floor(img.W / 6), Math.round(10 * scale));
  const rowInk = (y: number, x0 = edge, x1 = img.W - edge) => { let n = 0; for (let x = x0; x < x1; x++) if (dist(img.at(x, y), bg) > TH) n++; return n; };
  const colInk = (x: number, y0: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) if (dist(img.at(x, y), bg) > TH) n++; return n; };
  const runs = (len: number, ink: (i: number) => number, gap = 2) => {
    const out: [number, number][] = [];
    let s = -1, last = -1;
    for (let i = 0; i < len; i++) {
      if (ink(i) > 0) { if (s < 0) s = i; last = i; }
      else if (s >= 0 && i - last > gap) { out.push([s, last + 1]); s = -1; }
    }
    if (s >= 0) out.push([s, last + 1]);
    return out;
  };
  const px = (v: number) => +(v / scale).toFixed(1);
  return runs(img.H, (y) => rowInk(y)).map(([y0, y1]) => ({
    y: px(y0), h: px(y1 - y0),
    cols: runs(img.W, (x) => colInk(x, y0, y1), 6).map(([x0, x1]) => ({ x: px(x0), w: px(x1 - x0) })),
  }));
}

export async function runGrabImage(argv: string[]) {
  const a = new Args(argv);
  const images = a.positional;
  if (!images.length) usage('usage: clonethis grab-image <shot.png> [<shot-390.png> ...] --as name [--vp 1440,390] [--dsf 2 | --css-width 341,358] [--no-trim] [--brand Name] [--tokens a,b]');
  for (const f of images) if (!fs.existsSync(f)) usage(`no such file: ${f}`);
  const vpWidths = a.list('vp').map(Number);
  const widths = images.map((_f, i) => vpWidths[i] ?? (i === 0 ? 1440 : 390));
  const cssWidths = a.list('css-width').map(Number);
  const tokens = a.list('tokens').map((t) => t.toLowerCase());
  const brand = brandFor(process.cwd(), a.str('brand'));
  const clean = (t: string) => scrub(t, tokens, brand);
  const name = neutralComponentName(a.str('as'), tokens);
  const REF = path.join(process.cwd(), a.str('out', 'reference'), name);
  fs.rmSync(path.join(REF, 'capture'), { recursive: true, force: true });
  fs.mkdirSync(REF, { recursive: true });
  writeOrigin(REF, { url: 'file://' + path.resolve(images[0]), host: '', tokens, brand, capturedAt: new Date().toISOString() });
  if (!ocrAvailable()) log('ocr: not available on this machine (needs macOS + swiftc); text will not be read off the image');
  const meta: any = { mode: 'image', name, capturedAt: new Date().toISOString(), brand, viewports: {} };
  for (let i = 0; i < images.length; i++) {
    const vp = viewportByWidth(widths[i]);
    const dir = path.join(REF, 'capture', vp.name);
    fs.mkdirSync(dir, { recursive: true });
    // trim uniform margins (a screenshot crop is never exact), keep what was cut for the record
    let src = sharp(images[i]).flatten({ background: '#ffffff' });
    const orig = await sharp(images[i]).metadata();
    let trim = { left: 0, top: 0 };
    let trimmedSize = false;
    if (!a.flag('no-trim')) {
      try {
        // a high threshold cuts soft drop shadows (low contrast against the page) but keeps borders and fills
        const t = await src.clone().trim({ threshold: a.num('trim-threshold', 48) }).toBuffer({ resolveWithObject: true });
        if (t.info.width > 16 && t.info.height > 16 && (t.info.width < orig.width! || t.info.height < orig.height!)) {
          src = sharp(t.data);
          trim = { left: -(t.info.trimOffsetLeft ?? 0), top: -(t.info.trimOffsetTop ?? 0) };
          trimmedSize = true;
        }
      } catch {}
    }
    const buf = await src.png().toBuffer({ resolveWithObject: true });
    const dsf = cssWidths[i] ? buf.info.width / cssWidths[i] : a.num('dsf', 2);
    const cssW = +(buf.info.width / dsf).toFixed(2), cssH = +(buf.info.height / dsf).toFixed(2);
    const shot = path.join(dir, 'component.png');
    await sharp(buf.data).resize(Math.round(cssW * 2), Math.round(cssH * 2), { fit: 'fill' }).png().toFile(shot);
    const img = await raw(shot);
    const bg = borderColor(img, 12);
    const lines = ocr(shot).map((l) => ({ text: clean(l.text), x: +(l.x / 2).toFixed(1), y: +(l.y / 2).toFixed(1), w: +(l.w / 2).toFixed(1), h: +(l.h / 2).toFixed(1), confidence: l.confidence }));
    const pal = await palette(shot);
    const bd = bands(img, bg, 2);
    fs.writeFileSync(path.join(dir, 'ocr.json'), JSON.stringify(lines, null, 1));
    fs.writeFileSync(path.join(dir, 'palette.json'), JSON.stringify({ background: hex(bg), colors: pal }, null, 1));
    fs.writeFileSync(path.join(dir, 'bands.json'), JSON.stringify({ note: 'css px; rows of content separated by the background color, columns inside each row', background: hex(bg), rows: bd }, null, 1));
    fs.writeFileSync(path.join(dir, 'texts.json'), '[]');
    fs.writeFileSync(path.join(dir, 'media.json'), '[]');
    fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({ source: 'image', trimThreshold: a.flag('no-trim') ? null : a.num('trim-threshold', 48), viewport: { width: vp.width, height: vp.height }, rootRect: { x: 0, y: 0, w: cssW, h: cssH }, heightFromContext: { fromContext: false }, dsf: +dsf.toFixed(3), trimmed: trim, trimmedSize, backdrop: { page: hex(bg) } }, null, 1));
    meta.viewports[vp.name] = { width: vp.width, root: { w: cssW, h: cssH }, dsf: +dsf.toFixed(3), ocrLines: lines.length, rows: bd.length };
    log(`${vp.name} ${vp.width}px: ${cssW}x${cssH} css px (dsf ${dsf.toFixed(2)}${trimmedSize ? ', margins trimmed' : ''}), ${lines.length} text line(s), ${bd.length} row band(s), background ${hex(bg)}`);
  }
  fs.writeFileSync(path.join(REF, 'component.json'), JSON.stringify(meta, null, 1));
  const { writeBrief } = await import('./brief.ts');
  writeBrief(REF);
  log(`done -> ${path.relative(process.cwd(), REF)}`);
  return { REF, name };
}
