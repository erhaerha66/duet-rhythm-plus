import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assetTypes } from '../server/assets.mjs';

const root = new URL('../', import.meta.url);
const manifestPath = new URL('.openai/hosting.json', root);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (typeof manifest.project_id !== 'string' || !manifest.project_id.trim() ||
    manifest.static || manifest.d1 !== 'DB' || manifest.r2 !== 'REPORT_FILES') {
  throw new Error('See docs/deployment.md: use a new Sites project ID and the DB / REPORT_FILES bindings.');
}

const assets = Object.fromEntries(await Promise.all(Object.entries(assetTypes).map(async ([path, type]) => {
  let body = await readFile(new URL('public' + path, root));
  if (path === '/admin.html') {
    body = Buffer.from(body.toString('utf8').replace('<body>', '<body data-admin-auth="sites">'));
  }
  return [path, { type, bytes: body.toString('base64') }];
})));

await build({
  stdin: {
    contents: `import { createSitesWorker } from './server/sites.mjs'; export default createSitesWorker(${JSON.stringify(assets)});`,
    resolveDir: fileURLToPath(root)
  },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  outfile: fileURLToPath(new URL('dist/server/index.js', root))
});
await mkdir(new URL('dist/.openai/', root), { recursive: true });
await writeFile(new URL('dist/.openai/hosting.json', root), JSON.stringify(manifest, null, 2) + '\n');
await cp(new URL('drizzle/', root), new URL('dist/drizzle/', root), { recursive: true });
