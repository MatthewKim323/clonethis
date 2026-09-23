/**
 * OCR with boxes via Apple's Vision framework (src/ocr/ocr.swift, compiled on first use into
 * node_modules/.cache). macOS only; elsewhere, or if the compile fails, it returns [] and callers carry on
 * without text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type OcrLine = { text: string; x: number; y: number; w: number; h: number; confidence: number };

const SRC = path.join(import.meta.dirname, '..', 'ocr', 'ocr.swift');
const BIN = path.join(import.meta.dirname, '..', '..', 'node_modules', '.cache', 'ct-ocr');

function binary(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    if (!fs.existsSync(BIN) || fs.statSync(BIN).mtimeMs < fs.statSync(SRC).mtimeMs) {
      fs.mkdirSync(path.dirname(BIN), { recursive: true });
      execFileSync('swiftc', ['-O', SRC, '-o', BIN], { stdio: 'ignore', timeout: 180_000 });
    }
    return BIN;
  } catch { return null; }
}

/** Lines of text in an image, boxes in image pixels (top-left origin). */
export function ocr(image: string): OcrLine[] {
  const bin = binary();
  if (!bin) return [];
  try {
    const out = execFileSync(bin, [path.resolve(image)], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 << 20 });
    return (JSON.parse(out) as OcrLine[]).map((l) => ({ ...l, x: +l.x.toFixed(1), y: +l.y.toFixed(1), w: +l.w.toFixed(1), h: +l.h.toFixed(1), confidence: +l.confidence.toFixed(2) }));
  } catch { return []; }
}

export const ocrAvailable = () => binary() !== null;

// letters OCR reads out of the wrong script (Cyrillic / Greek look-alikes of Latin)
const CONFUSABLE: Record<string, string> = { 'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i', 'κ': 'k', 'ρ': 'p', 'τ': 't' };
export const unconfuse = (s: string) => s.replace(/[\u0370-\u04ff]/g, (c) => CONFUSABLE[c.toLowerCase()] ?? c);

/** Letters and digits only, lowercased: what two readings of the same text agree on. */
export const alnum = (s: string) => unconfuse(s.normalize('NFKD')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Fraction of a's character bigrams that also occur in b (1 when a is a substring of b). */
export function bigramRecall(a: string, b: string) {
  if (!a) return 1;
  if (b.includes(a)) return 1;
  if (a.length < 2) return b.includes(a) ? 1 : 0;
  const B = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) B.add(b.slice(i, i + 2));
  let n = 0;
  for (let i = 0; i < a.length - 1; i++) if (B.has(a.slice(i, i + 2))) n++;
  return n / (a.length - 1);
}

/** Lowercased word tokens, OCR noise (bullets, check glyphs, stray punctuation) dropped. */
export function words(s: string): string[] {
  return unconfuse(s.normalize('NFKD')).toLowerCase().replace(/[^\p{L}\p{N}$%.,/]+/gu, ' ').split(/\s+/).map((w) => w.replace(/^[.,/]+|[.,/]+$/g, '')).filter((w) => w.length > 0 && !/^[vx•·]$/.test(w));
}
