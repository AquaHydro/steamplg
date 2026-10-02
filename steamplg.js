// 通过 Steam 客户端的 CEF 调试端口，在商店游戏页标题旁标出 新史低 / 平史低。
// 价格数据来自 IsThereAnyDeal，在本进程里请求（商店页 CSP 禁止页面直接访问外部 API）。
// 默认走作者部署的 Cloudflare Worker（DEFAULT_SERVER，见 worker.js），用户不需要任何 Key。
// 也可在 config 里填 key 直连 ITAD，或填 server（+ token）换成自己部署的 Worker。
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fromItad, getJson } from './itad.js';

const CONFIG_PATH = join(homedir(), '.steamplg.json'); // 打包后的单文件程序也能找到
const CACHE_MS = 60 * 60 * 1000;
const DEFAULT_SERVER = 'https://steamplg.yiliang.app';
let cfg; // 全部可选：key / server / token / country / debugPort

const cache = new Map(); // `${appid}:${country}` -> { at, result }
async function lookup(appid, country) {
  const k = `${appid}:${country}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  let result = null;
  try {
    result = cfg.key && !cfg.server
      ? await fromItad(appid, country, cfg.key)
      : await getJson(`${cfg.server ?? DEFAULT_SERVER}/lowest?appid=${appid}&country=${country}`, cfg.token ? { authorization: `Bearer ${cfg.token}` } : {});
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

// ---- 开机自启（后台运行）：macOS 用 launchd，Windows 用「启动」文件夹里的 vbs，Linux 用 systemd 用户服务 ----
const LOG_PATH = join(homedir(), '.steamplg.log');
// 打包后的单文件程序直接跑自己；开发时（node steamplg.js）要带上脚本路径
const SELF = /^(node|bun)(\.exe)?$/i.test(basename(process.execPath)) ? [process.execPath, resolve(process.argv[1])] : [process.execPath];
const sh = (cmd, ...args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch {} }; // 停一个没在跑的服务会报错，忽略
// 从 Microsoft Store 装的 MSIX 版：写到 AppData 的文件会被重定向进包的私有目录，「启动」文件夹的 vbs 不生效，
// 自启改用清单里的 startupTask（msix/AppxManifest.xml），由用户在系统设置里开关
const MSIX = process.platform === 'win32' && /\\WindowsApps\\/i.test(process.execPath);
// 无窗口地另起一个自己，输出写进日志。MSIX 的 startupTask 只能启动带控制台的 exe，靠这个把窗口甩掉（会闪一下）
function background() {
  const log = openSync(LOG_PATH, 'a');
  spawn(SELF[0], [...SELF.slice(1), '--daemon'], { detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref();
}
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const AUTOSTART = {
  darwin: {
    file: join(homedir(), 'Library/LaunchAgents/app.steamplg.plist'),
    content: () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.steamplg</string>
  <key>ProgramArguments</key><array>${SELF.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(LOG_PATH)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG_PATH)}</string>
</dict></plist>
`,
    start: (f) => sh('launchctl', 'load', '-w', f),
    stop: (f) => sh('launchctl', 'unload', '-w', f),
    log: LOG_PATH,
  },
  win32: {
    file: join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs/Startup/steamplg.vbs'),
    // 窗口样式 0 = 隐藏，不弹黑框；输出经 cmd 重定向到日志
    content: () => {
      const line = `cmd /c "${SELF.map((a) => `"${a}"`).join(' ')} >> "${LOG_PATH}" 2>&1"`;
      return `\ufeffCreateObject("WScript.Shell").Run "${line.replace(/"/g, '""')}", 0, False\r\n`; // UTF-16 BOM，中文用户名路径才不乱码
    },
    encoding: 'utf16le',
    start: (f) => sh('wscript', f),
    // 按进程名结束，但别把正在执行 uninstall 的自己也杀了
    stop: () => sh('taskkill', '/f', '/im', basename(process.execPath), '/fi', `PID ne ${process.pid}`),
    log: LOG_PATH,
  },
  linux: {
    file: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd/user/steamplg.service'),
    content: () => `[Unit]
Description=steamplg

[Service]
ExecStart=${SELF.map((a) => `"${a}"`).join(' ')}
Restart=on-failure

[Install]
WantedBy=default.target
`,
    start: () => { sh('systemctl', '--user', 'daemon-reload'); sh('systemctl', '--user', 'enable', 'steamplg'); sh('systemctl', '--user', 'restart', 'steamplg'); },
    stop: () => sh('systemctl', '--user', 'disable', '--now', 'steamplg'),
    log: 'journalctl --user -u steamplg -f',
  },
}[process.platform] ?? null;

function install() {
  if (MSIX) {
    AUTOSTART.stop();
    background();
    sh('explorer', 'ms-settings:startupapps');
    console.log(`已在后台启动，日志：${LOG_PATH}\n要登录后自动运行，请在刚打开的「设置 → 应用 → 启动」里打开 steamplg 的开关。`);
    return;
  }
  const a = AUTOSTART;
  a.stop(a.file); // 重复 install 时先停掉旧的
  mkdirSync(dirname(a.file), { recursive: true });
  writeFileSync(a.file, a.content(), a.encoding ?? 'utf8');
  a.start(a.file);
  console.log(`已设为登录后自动在后台运行，现在已经启动。\n  配置：${a.file}\n  日志：${a.log}\n取消：steamplg uninstall。注意之后别移动或删除本程序文件，否则自启会失效。`);
}

function uninstall() {
  if (MSIX) {
    AUTOSTART.stop();
    sh('explorer', 'ms-settings:startupapps');
    console.log('后台进程已停止。要取消登录自启，请在刚打开的「设置 → 应用 → 启动」里关掉 steamplg 的开关。');
    return;
  }
  const a = AUTOSTART;
  a.stop(a.file);
  rmSync(a.file, { force: true });
  if (process.platform === 'linux') sh('systemctl', '--user', 'daemon-reload');
  console.log('已取消开机自启，后台进程已停止。');
}

async function setup(offerInstall) {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator](); // 逐行读，粘贴/管道多行输入也不会丢
  const ask = async (q) => { process.stdout.write(q); return ((await lines.next()).value ?? '').trim(); };
  const conf = { country: 'CN' }; // 写出来让人知道能改；有了这个文件，下次启动就不再问
  writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2));
  console.log(`首次运行，配置已保存到 ${CONFIG_PATH}（价格区默认国区，要改直接编辑这个文件）。`);
  if (offerInstall && process.stdin.isTTY && AUTOSTART && /^y/i.test(await ask('要设为登录后自动在后台运行吗？(y/N)：'))) {
    install();
    if (process.platform === 'win32') await ask('按回车关闭此窗口。'); // 双击运行时窗口会立刻关掉，先让人看到提示
    process.exit(0);
  }
  rl.close();
  return conf;
}

const sub = process.argv[2];
if ((sub === 'install' || sub === 'uninstall') && !AUTOSTART) { console.error(`不支持的系统：${process.platform}`); process.exit(1); }
if (sub === 'uninstall') { uninstall(); process.exit(0); }
if (sub === '--background') { background(); process.exit(0); } // MSIX 登录自启走这里
try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { cfg = await setup(sub !== 'install'); }
if (sub === 'install') { install(); process.exit(0); }
// ponytail: 每 2 秒轮询所有页面，够用；要更省就改成保持 CDP 连接监听导航事件
for (;;) { await poll(); await new Promise((r) => setTimeout(r, 2000)); }
