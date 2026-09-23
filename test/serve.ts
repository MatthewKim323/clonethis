// serve the fixture site for manual runs: bun test/serve.ts [port]
import path from 'node:path';
import { serveDir } from '../src/lib/serve.ts';
const s = await serveDir(path.join(import.meta.dirname, 'fixtures', 'site'), Number(process.argv[2] ?? 4791));
console.log(s.url);
