/**
 * Hangar pictures of the player ships: each ship from three views (front three-quarter,
 * broadside, rear three-quarter with the engines lit), rendered with three.js from the
 * game's own `-transformed.glb` files and saved as small WebP images that the hangar shows
 * while the player chooses. Only the chosen ship's model is downloaded, after "Launch".
 *
 *   node render_previews.mjs        (needs Google Chrome; CHROME=<path> to use another one,
 *                                    SWIFTSHADER=1 on a machine without a GPU)
 *
 * Writes src/game/ui/hangar/<classId>-<view>.webp. Re-run after changing a player model.
 */
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const models = path.join(repo, 'public/assets/game/player');
const outDir = path.join(repo, 'src/game/ui/hangar');
// three's package root (its "exports" hide package.json, so go up from the main build file).
const three = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('three'))), '..');

// Player class -> file and the turn that points its nose to -Z (MODEL_OVERRIDES in
// src/game/scene/models/ShipModel.jsx).
const SHIPS = {
    kestrel: { file: 'x-wing-transformed.glb', rotY: 0 },
    swift: { file: 'alien-spaceship-transformed.glb', rotY: Math.PI },
    shrike: { file: 'archont-transformed.glb', rotY: Math.PI / 2 },
    bulwark: { file: 'vigilant-transformed.glb', rotY: Math.PI },
    peregrine: { file: 'spaceship-transformed.glb', rotY: Math.PI },
};
const WIDTH = 480, HEIGHT = 270;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = p.startsWith('/models/') ? path.join(models, p.slice(8))
        : p.startsWith('/node_modules/three/') ? path.join(three, p.slice(20))
            : path.join(here, 'render_previews.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
}).listen(8126);

const executablePath = process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const args = process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] : [];
const browser = await puppeteer.launch({ executablePath, headless: 'new', args, protocolTimeout: 600000 });
fs.mkdirSync(outDir, { recursive: true });
for (const [classId, { file, rotY }] of Object.entries(SHIPS)) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(classId, e.message));
    await page.goto(`http://localhost:8126/?file=${encodeURIComponent(file)}&rotY=${rotY}&w=${WIDTH}&h=${HEIGHT}`);
    await page.waitForFunction('window.ready === true', { timeout: 600000, polling: 500 });
    const views = await page.evaluate(() => window.result);
    for (const [view, url] of Object.entries(views)) {
        const target = path.join(outDir, `${classId}-${view}.webp`);
        fs.writeFileSync(target, Buffer.from(url.split(',')[1], 'base64'));
        console.log(path.relative(repo, target), fs.statSync(target).size, 'bytes');
    }
    await page.close();
}
await browser.close(); srv.close();
