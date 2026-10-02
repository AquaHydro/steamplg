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
3. 运行程序：Windows 双击 exe 即可；macOS / Linux 在终端里运行 `./steamplg-…`。第一次运行时，输入以下两者之一：
   - **ITAD API Key**：在 https://isthereanydeal.com/apps/my/ 注册一个应用即可免费获得。
   - **Cloudflare Worker 地址 + TOKEN**：见下文。填这一项的话，本机不需要 Key。

   输入的内容会保存到用户目录下的 `.steamplg.json`，以后启动不会再问。程序需要一直开着。

**macOS / Linux 首次运行**：浏览器下载的文件没有可执行权限，先执行一次 `chmod +x steamplg-*`。Mac 版已经过 Apple 签名和公证，第一次运行时需要联网，让系统向 Apple 确认。

## 用 Cloudflare 托管 Key（可选）

如果你有多台电脑，或者想把工具分享给朋友但不想交出 Key，可以把 Key 存到 Cloudflare Worker 的 Secret 里。免费额度是每天 10 万次请求。

```bash
npx wrangler login
npx wrangler deploy                # 部署后会得到 https://steamplg.<你的子域>.workers.dev
npx wrangler secret put ITAD_KEY   # 粘贴 ITAD Key
npx wrangler secret put TOKEN      # 自己随便定一个较长的口令
```

各客户端第一次运行时，输入 Worker 地址和 TOKEN 即可。没有 TOKEN 的请求一律返回 403。

## .steamplg.json 字段

| 字段 | 默认值 | 说明 |
|---|---|---|
| `key` | | ITAD API Key（直连 ITAD 时用） |
| `server` | | Worker 地址（填了就不直连 ITAD） |
| `token` | | Worker 的 TOKEN |
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

## 注意

调试端口只监听本机，但开着时，本机任何程序都能控制 Steam 的网页界面。不用的时候，正常重启 Steam（不带参数）即可关闭。

价格数据来自 [IsThereAnyDeal](https://isthereanydeal.com)。

## 签名与隐私

macOS 版用作者的 Apple Developer ID 签名，并经过 Apple 公证。Windows 版目前没有签名，运行时如果出现 SmartScreen 警告，点「仍要运行」即可。

Privacy policy: this program will not transfer any information to other networked systems other than those described here. For each Steam store page you open, it sends the game's Steam app ID and your configured country code either to the [IsThereAnyDeal API](https://docs.isthereanydeal.com/) (with your own API key) or to the Cloudflare Worker you deploy yourself. It only talks to the Steam client through its local debugging port (127.0.0.1).

## License

[MIT](LICENSE)
