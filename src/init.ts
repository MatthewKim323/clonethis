/**
 * init: put the build rulebook for a grabbed component into a project.
 *   clonethis init <projectDir> [--ref reference/<name>] [--brand Name] [--port 3777] [--stack "..."] [--file path] [--route /clonethis/<name>] [--force]
 * Writes <project>/reference/CONVENTIONS.md and GOAL.md from templates/, filled for this project's stack
 * (read off package.json) and this component. Existing files are kept unless --force. Gitignores the one file
 * that names the origin (reference/*\/.origin.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from './lib/args.ts';
import { readOrigin, writeOrigin, brandFor } from './lib/anon.ts';

const TEMPLATES = path.resolve(import.meta.dirname, '..', 'templates');
const IGNORE_LINE = 'reference/*/.origin.json';

export type ProjectStack = { kind: 'next' | 'vite-react' | 'react' | 'svelte' | 'vue' | 'astro' | 'html'; label: string; tailwind: boolean; motion: string | null; ts: boolean };

export function detectProject(dir: string): ProjectStack {
  const pj = path.join(dir, 'package.json');
  const deps: Record<string, string> = fs.existsSync(pj) ? (() => { const p = JSON.parse(fs.readFileSync(pj, 'utf8')); return { ...p.dependencies, ...p.devDependencies }; })() : {};
  const has = (k: string) => k in deps;
  const tailwind = has('tailwindcss');
  const motion = has('motion') ? 'motion ("motion/react")' : has('framer-motion') ? 'framer-motion' : has('gsap') ? 'gsap' : null;
  const ts = has('typescript') || fs.existsSync(path.join(dir, 'tsconfig.json'));
  let kind: ProjectStack['kind'] = 'html';
  if (has('next')) kind = 'next';
  else if (has('@sveltejs/kit') || has('svelte')) kind = 'svelte';
  else if (has('nuxt') || has('vue')) kind = 'vue';
  else if (has('astro')) kind = 'astro';
  else if (has('vite') && has('react')) kind = 'vite-react';
  else if (has('react')) kind = 'react';
  const names: Record<ProjectStack['kind'], string> = { next: 'Next.js (App Router) + React', 'vite-react': 'Vite + React', react: 'React', svelte: 'Svelte', vue: 'Vue', astro: 'Astro', html: 'plain HTML + CSS' };
  return { kind, label: `${names[kind]}${ts && kind !== 'html' ? ' + TypeScript' : ''}${tailwind ? ' (Tailwind installed)' : ''}${motion ? ` + ${motion}` : ''}`, tailwind, motion, ts };
}

/** Where the component file and the page that renders it for verify should go, per stack. */
export function harness(stack: ProjectStack, name: string) {
  const Comp = name.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Component';
  const ext = stack.ts ? 'tsx' : 'jsx';
  switch (stack.kind) {
    case 'next': return { file: `components/clone/${name}.${ext}`, page: `app/clonethis/${name}/page.${ext}`, route: `/clonethis/${name}`, Comp };
    case 'vite-react': case 'react': return { file: `src/components/${Comp}.${ext}`, page: `src/main.${ext} (render <${Comp}/> when location.search has ?clone=${name})`, route: `/?clone=${name}`, Comp };
    case 'svelte': return { file: `src/lib/components/${Comp}.svelte`, page: `src/routes/clonethis/${name}/+page.svelte`, route: `/clonethis/${name}`, Comp };
    case 'vue': return { file: `components/${Comp}.vue`, page: `pages/clonethis/${name}.vue`, route: `/clonethis/${name}`, Comp };
    case 'astro': return { file: `src/components/${Comp}.astro`, page: `src/pages/clonethis/${name}.astro`, route: `/clonethis/${name}`, Comp };
    default: return { file: `components/${name}.html + components/${name}.css`, page: `clonethis/${name}.html`, route: `/clonethis/${name}.html`, Comp };
  }
}

export function runInit(argv: string[]) {
  const a = new Args(argv);
  const project = a.positional[0];
  if (!project) usage('usage: clonethis init <projectDir> [--ref reference/<name>] [--brand Name] [--port 3777] [--stack "..."] [--file path] [--route /path] [--force]');
  const abs = path.resolve(project);
  const refDir = a.str('ref') ?? (() => {
    const r = path.join(abs, 'reference');
    const cands = fs.existsSync(r) ? fs.readdirSync(r).filter((d) => fs.existsSync(path.join(r, d, 'component.json'))) : [];
    if (cands.length > 1) console.log(`several components under reference/: ${cands.join(', ')}. Using ${cands[0]}; pass --ref for another.`);
    return cands.length ? path.join('reference', cands[0]) : 'reference/<name>';
  })();
  const refAbs = path.resolve(abs, refDir);
  const name = path.basename(refDir);
  const origin = readOrigin(refAbs);
  const brand = brandFor(abs, a.str('brand') ?? (origin?.brand && origin.brand !== 'brand' ? origin.brand : undefined));
  if (origin && origin.brand !== brand) {
    writeOrigin(refAbs, { ...origin, brand });
    console.log(`brand for this project: "${brand}" (was "${origin.brand}"). Re-grab to have the reference read the same.`);
  }
  const stack = detectProject(abs);
  const h = harness(stack, name);
  const meta = fs.existsSync(path.join(refAbs, 'component.json')) ? JSON.parse(fs.readFileSync(path.join(refAbs, 'component.json'), 'utf8')) : {};
  const widths = Object.values<any>(meta.viewports ?? {}).filter((v) => v.found !== false).map((v) => v.width);
  const sizes = Object.entries<any>(meta.viewports ?? {}).filter(([, v]) => v.found !== false).map(([k, v]) => `${k} ${v.width}px: ${v.root.w} x ${v.root.h}${v.heightFromContext ? ' (height from its container)' : ''}`).join('; ');
  const vars: Record<string, string> = {
    PROJECT: abs, BRAND: brand, REF: refDir, REF_ABS: refAbs, NAME: name, COMP: h.Comp,
    PORT: String(a.num('port', 3777)),
    STACK: a.str('stack', stack.label),
    FILE: a.str('file', h.file), PAGE: h.page, ROUTE: a.str('route', h.route),
    WIDTHS: (widths.length ? widths : [1440, 1024, 810, 390]).join(' / '),
    SIZES: sizes || '(see the reference REBUILD.md)',
    MOTION: stack.motion ?? 'CSS transitions / keyframes (add a motion library only if the reference motion is spring or scroll driven)',
    STYLING: stack.tailwind ? 'Tailwind is installed, but exact values from the spec go in a scoped stylesheet / CSS module (or arbitrary values) so nothing is rounded to a scale' : 'a scoped stylesheet (CSS module, <style> block, or a prefixed class namespace)',
    DATE: new Date().toISOString().slice(0, 10),
  };
  fs.mkdirSync(path.join(abs, 'reference'), { recursive: true });
  for (const f of ['CONVENTIONS.md', 'GOAL.md']) {
    const dst = path.join(abs, 'reference', f);
    if (fs.existsSync(dst) && !a.flag('force')) { console.log(`keep ${dst} (exists; --force to overwrite)`); continue; }
    let s = fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{{${k}}}`, v);
    fs.writeFileSync(dst, s);
    console.log(`wrote ${dst}`);
  }
  const gi = path.join(abs, '.gitignore');
  const body = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!body.split('\n').some((l) => l.trim() === IGNORE_LINE)) {
    fs.writeFileSync(gi, (body && !body.endsWith('\n') ? body + '\n' : body) + `\n# origin blackout: the source url stays local\n${IGNORE_LINE}\n`);
    console.log(`gitignored ${IGNORE_LINE}`);
  }
  console.log(`\nstack: ${stack.label}\ncomponent file: ${vars.FILE}\nverify page: ${h.page} -> http://localhost:${vars.PORT}${vars.ROUTE}`);
}
