import { access, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of ['public/index.html', 'public/style.css', 'public/app.js', 'api/index.mjs']) await access(resolve(root, file));
async function checkJavaScript(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) await checkJavaScript(path);
    else if (/\.(?:m?js)$/.test(name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${path}`);
    }
  }
}
await checkJavaScript(resolve(root, 'public'));
await checkJavaScript(resolve(root, 'api'));
try { await access(resolve(root, 'supabase/functions')); await checkJavaScript(resolve(root, 'supabase/functions')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Build ready: public files and server JavaScript validated.');
