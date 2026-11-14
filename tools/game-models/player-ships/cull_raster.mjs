/**
 * Optional second opinion for hidden-geometry culling: renders the triangles from 320 views
 * (orthographic and close perspective, 2048 px) with one colour per triangle and records
 * every triangle that shows up in any pixel. cull_vis.py keeps those too, which catches
 * triangles that are only visible through cracks narrower than its rays can find.
 *
 *   node cull_raster.mjs <work-dir> <prefix> [...]      (needs Google Chrome)
 */
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [work, ...names] = process.argv.slice(2);
const three = path.dirname(fileURLToPath(import.meta.resolve('three/package.json')));
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p.startsWith('/work/') ? path.join(work, p.slice(6)) : p.startsWith('/node_modules/three/') ? path.join(three, p.slice(20)) : path.join(here, 'cull_raster.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8125);
const executablePath = process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const browser = await puppeteer.launch({ executablePath, headless: 'new', protocolTimeout: 1800000 });
for (const name of names) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:8125/?p=${name}&res=2048&n=160`);
  await page.waitForFunction('window.ready === true', { timeout: 1800000, polling: 2000 });
  const r = await page.evaluate(() => window.result);
  fs.writeFileSync(path.join(work, `${name}.raster.bin`), Buffer.from(Uint8Array.from(r.visible)));
  console.log(name, 'visible in some view:', r.count, 'of', r.visible.length);
  await page.close();
}
await browser.close(); srv.close();
