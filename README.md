# steamplg

在 Steam 客户端里浏览商店游戏页时，标题旁会显示 **新史低 / 平史低 / 非史低**。支持 Windows、macOS 和 Linux。

## 原理

Steam 客户端的商店页是内置 Chromium（CEF）渲染的。用 `-cef-enable-debugging` 参数启动 Steam 后，它会在 `127.0.0.1:8080` 开放调试端口。本程序通过这个端口找到当前打开的游戏页，到 IsThereAnyDeal（ITAD）查询 Steam 在你所在区的历史价格，然后把标签插进页面。

## 使用

1. 从 [Releases](https://github.com/AquaHydro/steamplg/releases/latest) 下载对应系统的程序（单个文件，不需要安装 Node）：

   | 系统 | 文件 |
   |---|---|
   | Windows | `steamplg-windows-x64.exe` |
   | macOS（Apple 芯片） | `steamplg-darwin-arm64` |
   | macOS（Intel） | `steamplg-darwin-x64` |
   | Linux | `steamplg-linux-x64` / `steamplg-linux-arm64` |

2. **完全退出 Steam**，再带参数启动：
   - macOS：`open -a Steam --args -cef-enable-debugging`
   - Windows：`"C:\Program Files (x86)\Steam\steam.exe" -cef-enable-debugging`
   - Linux：`steam -cef-enable-debugging`
3. 运行程序：Windows 双击 exe 即可；macOS / Linux 在终端里运行 `./steamplg-…`。不需要申请任何 Key，价格数据由作者部署的服务器提供。程序需要一直开着。

   第一次运行时会在用户目录下生成 `.steamplg.json`，并问要不要设为**登录后自动在后台运行**，选 `y` 就不用每次手动开了，也不会占着一个终端窗口。以后也可以随时设置或取消：

   ```bash
   ./steamplg-… install     # 设为后台自启（Windows：steamplg-windows-x64.exe install）
   ./steamplg-… uninstall   # 取消自启并停止后台进程
   ```

   | 系统 | 实现方式 | 日志 |
   |---|---|---|
   | macOS | `~/Library/LaunchAgents/app.steamplg.plist`（launchd，崩溃后自动重启） | `~/.steamplg.log` |
   | Windows | 「启动」文件夹里的 `steamplg.vbs`（隐藏窗口运行） | `%USERPROFILE%\.steamplg.log` |
   | Linux | `~/.config/systemd/user/steamplg.service` | `journalctl --user -u steamplg -f` |

   自启配置里记录的是程序当前所在的路径。设置之后如果移动了程序文件，需要重新执行一次 `install`。

**macOS / Linux 首次运行**：浏览器下载的文件没有可执行权限，先执行一次 `chmod +x steamplg-*`。Mac 版已经过 Apple 签名和公证，第一次运行时需要联网，让系统向 Apple 确认。

## 自己部署服务器（可选）

默认的价格服务器是作者用 Cloudflare Worker（[worker.js](worker.js)）部署的，它持有 ITAD Key，所有用户共用。如果不想依赖它，可以部署一份自己的，免费额度是每天 10 万次请求：

```bash
npx wrangler login
npx wrangler deploy                # 部署后会得到 https://steamplg.<你的子域>.workers.dev
npx wrangler secret put ITAD_KEY   # 粘贴 ITAD Key（https://isthereanydeal.com/apps/my/ 免费申请）
npx wrangler secret put TOKEN      # 可选：设了就只有带这个口令的客户端能用
```

然后在 `.steamplg.json` 里填上 `server`（和 `token`）。也可以不要服务器，直接填 `key` 让本机直连 ITAD。

注意：`*.workers.dev` 域名在国内经常连不上，而且 Worker 的缓存只在自定义域名上生效，建议给 Worker 绑一个自己的域名。

## .steamplg.json 字段

| 字段 | 默认值 | 说明 |
|---|---|---|
| `server` | 作者的服务器 | 价格服务器地址 |
| `token` | | 服务器的 TOKEN（自建并设了 TOKEN 时填） |
| `key` | | ITAD API Key，填了且没填 `server` 时本机直连 ITAD |
| `country` | `CN` | 价格所在区，要和你的 Steam 商店区一致 |
| `debugPort` | `8080` | Steam 的调试端口 |

## 判定规则

- 只看 Steam 自己的历史价格，不含其他商店，而且只比较同币种的打折记录。
- 现价低于以前所有折扣价：新史低。
- 现价等于以前的最低折扣价：平史低。
- 免费游戏不显示标签。

## 开发

```bash
npm start       # 用 Node 22+ 直接运行
npm test        # 测试史低判断逻辑
npm run build   # 打包 5 个平台的程序到 dist/（需要 bun，在 macOS 上运行）
```

构建时，如果钥匙串里有 Developer ID Application 证书，Mac 版会自动用它正式签名。如果还存了名为 `steamplg` 的公证凭据，会顺带提交公证。公证凭据只需要存一次：

```bash
xcrun notarytool store-credentials steamplg --apple-id <你的 Apple ID> --team-id <Team ID>
```

运行后它会要你输入 App 专用密码，在 https://account.apple.com 的「登录与安全」里生成。

### Microsoft Store

GitHub 上发布 Release 后，`.github/workflows/windows.yml` 会额外打出 `steamplg-<版本>.msix` 并传到 Release。把它下载下来，在 Partner Center 里提交到商店，审核通过后由微软签名，不需要自己的证书。也可以在 Actions 页手动运行这个 workflow 试打包，产物在 artifact 里。

- 包清单在 [msix/AppxManifest.xml](msix/AppxManifest.xml)，图标在 `msix/Assets/`。
- 商店版的登录自启由清单里的 startupTask 实现，默认关闭，用户在「设置 → 应用 → 启动」里打开。`install` / `uninstall` 在商店版里会直接打开这个设置页。
- 每次提交的版本号必须比上一次大，由 Release 的 tag 决定（`v0.2.0` → `0.2.0.0`）。

## 注意

调试端口只监听本机，但开着时，本机任何程序都能控制 Steam 的网页界面。不用的时候，正常重启 Steam（不带参数）即可关闭。

价格数据来自 [IsThereAnyDeal](https://isthereanydeal.com)。

## 签名与隐私

macOS 版用作者的 Apple Developer ID 签名，并经过 Apple 公证。Windows 版：从 Microsoft Store 安装的版本由微软签名；GitHub 上的 exe 没有签名，运行时如果出现 SmartScreen 警告，点「仍要运行」即可。

Privacy policy: this program will not transfer any information to other networked systems other than those described here. For each Steam store page you open, it sends the game's Steam app ID and your configured country code to the maintainer's price server (a Cloudflare Worker, which forwards the query to the [IsThereAnyDeal API](https://docs.isthereanydeal.com/)), or to the server / ITAD key you configure yourself. The price server keeps no logs of its own; like any website on Cloudflare, Cloudflare processes your IP address to deliver the request and apply rate limits. It only talks to the Steam client through its local debugging port (127.0.0.1).

## License

[MIT](LICENSE)
