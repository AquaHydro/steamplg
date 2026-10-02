// 通过 Steam 客户端的 CEF 调试端口，在商店游戏页标题旁标出 新史低 / 平史低。
// 价格数据来自 IsThereAnyDeal，在本进程里请求（商店页 CSP 禁止页面直接访问外部 API）。
// 可直连 ITAD（config 填 key），也可走自己部署的 Cloudflare Worker（config 填 server + token，见 worker.js）。
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fromItad, getJson } from './itad.js';

const CONFIG_PATH = join(homedir(), '.steamplg.json'); // 打包后的单文件程序也能找到
const CACHE_MS = 60 * 60 * 1000;
let cfg; // { key } 或 { server, token }，可选 country / debugPort

const cache = new Map(); // `${appid}:${country}` -> { at, result }
async function lookup(appid, country) {
  const k = `${appid}:${country}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  let result = null;
  try {
    result = cfg.server
      ? await getJson(`${cfg.server}/lowest?appid=${appid}&country=${country}`, { authorization: `Bearer ${cfg.token}` })
      : await fromItad(appid, country, cfg.key);
    console.log(`app ${appid} ${country}: ${result?.text ?? '无数据'}`);
  } catch (e) {
    console.error(`app ${appid} ${country}: ${e.message}`);
  }
  cache.set(k, { at: Date.now(), result }); // 失败也缓存，避免反复重试刷 API
  return result;
}

// 幂等：标题还没渲染或标签已存在就什么都不做，下一轮轮询再试
const badgeJs = (r) => `(() => {
  const h = document.querySelector('.apphub_AppName');
  if (!h || document.getElementById('steamplg')) return;
  const b = document.createElement('span');
  b.id = 'steamplg';
  b.textContent = ${JSON.stringify(r.text)};
  b.style.cssText = 'margin-left:10px;padding:2px 8px;border-radius:3px;font-size:14px;color:#fff;background:${r.color}';
  h.append(b);
})()`;

function evaluate(wsUrl, expression) {
  return new Promise((done) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }));
    ws.onmessage = () => ws.close();
    ws.onclose = done;
    ws.onerror = done;
  });
}

const LAUNCH = {
  darwin: 'open -a Steam --args -cef-enable-debugging',
  win32: '"C:\\Program Files (x86)\\Steam\\steam.exe" -cef-enable-debugging',
  linux: 'steam -cef-enable-debugging',
};

let connected = null;
async function poll() {
  const port = cfg.debugPort ?? 8080;
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    if (connected !== false) console.log(`连不上 Steam 调试端口 ${port}。请完全退出 Steam，再这样启动：\n  ${LAUNCH[process.platform] ?? LAUNCH.linux}`);
    connected = false;
    return;
  }
  if (!connected) console.log('已连接 Steam 客户端，打开任意商店游戏页即可。');
  connected = true;
  for (const t of targets) {
    const appid = t.url.match(/^https:\/\/store\.steampowered\.com\/app\/(\d+)/)?.[1];
    if (!appid || !t.webSocketDebuggerUrl) continue;
    const r = await lookup(appid, cfg.country ?? 'CN');
    if (r) await evaluate(t.webSocketDebuggerUrl, badgeJs(r));
  }
}

async function setup() {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator](); // 逐行读，粘贴/管道多行输入也不会丢
  const ask = async (q) => { process.stdout.write(q); return ((await lines.next()).value ?? '').trim(); };
  const ans = await ask('首次运行，请输入 ITAD API Key（https://isthereanydeal.com/apps/my/ 免费申请），\n或你部署的 Cloudflare Worker 地址（https 开头）：');
  const conf = ans.startsWith('http')
    ? { server: ans.replace(/\/+$/, ''), token: await ask('Worker 的 TOKEN：') }
    : { key: ans };
  rl.close();
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2));
  console.log(`已保存到 ${CONFIG_PATH}，以后想改直接编辑这个文件。`);
  return conf;
}

try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { cfg = await setup(); }
// ponytail: 每 2 秒轮询所有页面，够用；要更省就改成保持 CDP 连接监听导航事件
for (;;) { await poll(); await new Promise((r) => setTimeout(r, 2000)); }
