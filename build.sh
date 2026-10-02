#!/bin/sh
# 把 steamplg.js 打包成 5 个平台的单文件程序，输出到 dist/。需要 bun；在 macOS 上运行（要给 mac 产物重签名）。
# 交叉编译要用到各平台的 Bun 运行时：用 curl 下载（可断点续传，比 bun 自带下载快），
# 按 npm 官方源公布的 sha512 校验后缓存在 ~/.cache/steamplg-bun。
set -e
cd "$(dirname "$0")"
V=$(bun --version)
C=~/.cache/steamplg-bun
HOST=$(bun -e 'console.log(process.platform.replace("win32", "windows") + "-" + process.arch)')
mkdir -p "$C" dist

for pkg in windows-x64 darwin-arm64 darwin-x64 linux-x64 linux-aarch64; do
  target=$(echo "$pkg" | sed 's/aarch64/arm64/') # npm 包名用 aarch64，bun --target 用 arm64
  if [ "$target" = "$HOST" ]; then
    bun build steamplg.js --compile --minify --target="bun-$target" --outfile "dist/steamplg-$target"
    continue
  fi
  tgz="$C/bun-$pkg-$V.tgz"
  want=$(curl -fsL "https://registry.npmjs.org/@oven/bun-$pkg/$V" | bun -e 'console.log((await Bun.stdin.json()).dist.integrity)')
  have() { echo "sha512-$(openssl dgst -sha512 -binary "$tgz" | openssl base64 -A)"; }
  if [ ! -f "$tgz" ] || [ "$(have)" != "$want" ]; then
    curl -fL -C - --retry 5 -o "$tgz" "https://registry.npmjs.org/@oven/bun-$pkg/-/bun-$pkg-$V.tgz" || true
    [ "$(have)" = "$want" ] || { echo "校验失败：$tgz，删掉后重试"; exit 1; }
  fi
  exe=bun; [ "$pkg" = windows-x64 ] && exe=bun.exe
  tar -xzf "$tgz" -C "$C" --strip-components=2 "package/bin/$exe"
  mv "$C/$exe" "$C/bun-$pkg-$V${exe#bun}"
  bun build steamplg.js --compile --minify --target="bun-$target" \
    --compile-executable-path="$C/bun-$pkg-$V${exe#bun}" --outfile "dist/steamplg-$target"
done

# bun 往二进制里追加代码后原签名失效，macOS 会直接 kill 掉进程，必须重签。
# 有 Developer ID 证书就正式签名（hardened runtime + JIT 权限，公证的前提），否则 ad-hoc 签名只能本机用
ID=$(security find-identity -v -p codesigning | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')
if [ -n "$ID" ]; then
  codesign --force --timestamp --options runtime --entitlements entitlements.plist --sign "$ID" dist/steamplg-darwin-*
  # 公证凭据先用 xcrun notarytool store-credentials steamplg 存进钥匙串（见 README）
  if xcrun notarytool history --keychain-profile steamplg >/dev/null 2>&1; then
    rm -f dist/mac-notarize.zip
    zip -qj dist/mac-notarize.zip dist/steamplg-darwin-*
    xcrun notarytool submit dist/mac-notarize.zip --keychain-profile steamplg --wait
    rm dist/mac-notarize.zip # 裸可执行文件无法 staple，公证结果由 Gatekeeper 联网查询
  else
    echo "跳过公证：钥匙串里没有 steamplg 公证凭据"
  fi
else
  codesign --force --sign - dist/steamplg-darwin-*
fi
ls -la dist
