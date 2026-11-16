// Tiny CDP client: node cdp.mjs <file.js | -e "expr">  -> evaluates in the game tab, prints JSON.
import { readFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || 9333;
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, Number(process.env.CDP_TIMEOUT || 90) * 1000).unref();
const args = process.argv.slice(2);
const expr = args[0] === '-e' ? args[1] : readFileSync(args[0], 'utf8');
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) ?? targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if (args.includes('--shot')) {
  const out = args[args.indexOf('--shot') + 1];
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  (await import('node:fs')).writeFileSync(out, Buffer.from(r.result.data, 'base64'));
}
const res = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
if (res.result?.exceptionDetails) console.log('EXC', JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails, null, 1));
else console.log(typeof res.result?.result?.value === 'string' ? res.result.result.value : JSON.stringify(res.result?.result?.value, null, 1));
ws.close();
