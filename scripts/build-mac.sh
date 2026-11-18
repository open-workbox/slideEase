#!/usr/bin/env bash
# 在 Linux/WSL 里组装 macOS 的 SlideEase.app 并打成 tar.gz
# 用法：bash scripts/build-mac.sh <项目目录> <electron-darwin-<arch>.zip> <输出目录> <arch:arm64|x64>
# 说明：electron-builder 无法在 Windows 上打 Mac 包，这里手工组装用于本地测试分发。
#       正式发布建议用 GitHub Actions 的 macOS runner（会生成签名友好的 dmg）。
set -euo pipefail
SRC="$1"; ZIP="$2"; OUT="$3"; ARCH="${4:-arm64}"
WORK="$(mktemp -d)"
unzip -q "$ZIP" -d "$WORK"
APP="$WORK/SlideEase.app"
mv "$WORK/Electron.app" "$APP"
APPDIR="$APP/Contents/Resources/app"
mkdir -p "$APPDIR"

# 源文件
cp "$SRC/main.js" "$SRC/preload.js" "$SRC/history.js" "$SRC/analytics.js" "$SRC/updater.js" "$SRC/package.json" "$APPDIR/"
cp -r "$SRC/renderer" "$APPDIR/renderer"
mkdir -p "$APPDIR/build"
cp "$SRC/build/icon.png" "$APPDIR/build/" 2>/dev/null || true

# 生产依赖：posthog-node 及其依赖链（posthog-node -> @posthog/core -> @posthog/types）
mkdir -p "$APPDIR/node_modules/@posthog"
[ -d "$SRC/node_modules/posthog-node" ] && cp -r "$SRC/node_modules/posthog-node" "$APPDIR/node_modules/"
[ -d "$SRC/node_modules/@posthog/core" ] && cp -r "$SRC/node_modules/@posthog/core" "$APPDIR/node_modules/@posthog/"
[ -d "$SRC/node_modules/@posthog/types" ] && cp -r "$SRC/node_modules/@posthog/types" "$APPDIR/node_modules/@posthog/"

# 应用图标（icon.png -> icon.icns），需要 iconutil/png2icns 其一；没有则跳过，用默认图标
ICNS="$APP/Contents/Resources/electron.icns"
if command -v png2icns >/dev/null 2>&1; then
  png2icns "$ICNS" "$SRC/build/icon.png" 2>/dev/null || true
fi

python3 - "$APP/Contents/Info.plist" "$ARCH" <<'PY'
import plistlib, sys
p = sys.argv[1]
d = plistlib.load(open(p, 'rb'))
d['CFBundleName'] = 'SlideEase'
d['CFBundleDisplayName'] = 'SlideEase'
d['CFBundleIdentifier'] = 'com.slideease.app'
d['CFBundleShortVersionString'] = '0.6.0'
d['CFBundleVersion'] = '0.6.0'
d['CFBundleDocumentTypes'] = [{
    'CFBundleTypeName': 'HTML Document',
    'CFBundleTypeRole': 'Editor',
    'CFBundleTypeExtensions': ['html', 'htm'],
    'LSHandlerRank': 'Alternate',
}]
d.pop('ElectronAsarIntegrity', None)
plistlib.dump(d, open(p, 'wb'))
PY

mkdir -p "$OUT"
OUTFILE="$OUT/SlideEase-mac-$ARCH.tar.gz"
tar -C "$WORK" -czf "$OUTFILE" SlideEase.app
rm -rf "$WORK"
ls -la "$OUTFILE"
