#!/usr/bin/env bash
set -euo pipefail
GC_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -eq 0 ]]; then set -- gui; fi
case "$(uname -s)" in
  Darwin) GC_CACHE="${GC_BRIDGE_CACHE_DIR:-$HOME/Library/Caches/GCBridge}" ;;
  Linux) GC_CACHE="${GC_BRIDGE_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/gc-bridge}" ;;
  *) echo 'Use the compiled GCBridge.exe on Windows.' >&2; exit 1 ;;
esac
if [[ -x "$GC_ROOT/GCBridge" ]]; then exec "$GC_ROOT/GCBridge" "$@"; fi
GC_RUNTIME="$GC_CACHE/runtime"
if [[ -x "$GC_RUNTIME/bin/bun" ]]; then GC_BUN="$GC_RUNTIME/bin/bun"
elif command -v bun >/dev/null 2>&1; then GC_BUN="$(command -v bun)"
elif [[ -x /tmp/gc-bridge-runtime/package/bin/bun ]]; then
  mkdir -p -- "$GC_RUNTIME/bin"; cp -- /tmp/gc-bridge-runtime/package/bin/bun "$GC_RUNTIME/bin/bun"; chmod 755 "$GC_RUNTIME/bin/bun"; GC_BUN="$GC_RUNTIME/bin/bun"
else
  command -v curl >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 || { echo 'Download the standalone GCBridge build, or install curl and unzip for source bootstrap.' >&2; exit 1; }
  case "$(uname -s)" in Darwin) GC_OS=darwin;; *) GC_OS=linux;; esac
  GC_MACHINE="$(uname -m)"
  if [[ "$GC_OS" == darwin ]] && [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then GC_MACHINE=arm64; fi
  case "$GC_MACHINE" in arm64|aarch64) GC_ARCH=aarch64;; x86_64|amd64) GC_ARCH=x64;; *) echo 'Unsupported CPU; use a matching compiled release.' >&2; exit 1;; esac
  GC_VARIANT="bun-$GC_OS-$GC_ARCH"
  if [[ "$GC_ARCH" == x64 ]]; then GC_VARIANT="$GC_VARIANT-baseline"; fi
  mkdir -p -- "$GC_RUNTIME"
  curl -fL --retry 2 "https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/$GC_VARIANT.zip" -o "$GC_RUNTIME/bun.zip" >&2
  unzip -oq "$GC_RUNTIME/bun.zip" -d "$GC_RUNTIME"
  mkdir -p -- "$GC_RUNTIME/bin"; mv -- "$GC_RUNTIME/$GC_VARIANT/bun" "$GC_RUNTIME/bin/bun"; chmod 755 "$GC_RUNTIME/bin/bun"
  GC_BUN="$GC_RUNTIME/bin/bun"
fi
export PATH="$(dirname -- "$GC_BUN"):$PATH"
export BUN_INSTALL_CACHE_DIR="$GC_CACHE/bun"
export TMPDIR="${GC_BRIDGE_TMPDIR:-$GC_CACHE/tmp}"
mkdir -p -- "$TMPDIR"
GC_LOCK_HASH="$("$GC_BUN" -e 'console.log(new Bun.CryptoHasher("sha256").update(await Bun.file(process.argv[1]).arrayBuffer()).digest("hex"))' "$GC_ROOT/package-lock.json")"
GC_DEPS="$GC_CACHE/dependencies/$GC_LOCK_HASH"
if [[ ! -f "$GC_DEPS/.ready" ]]; then
  mkdir -p -- "$GC_DEPS"
  cp -- "$GC_ROOT/package.json" "$GC_ROOT/package-lock.json" "$GC_DEPS/"
  (cd -- "$GC_DEPS" && "$GC_BUN" install --ignore-scripts --no-progress >&2)
  touch "$GC_DEPS/.ready"
fi
mkdir -p -- "$GC_DEPS/app"
cp -R -- "$GC_ROOT/src" "$GC_DEPS/app/"; cp -- "$GC_ROOT/package.json" "$GC_DEPS/app/package.json"
ln -sfn -- "$GC_DEPS/node_modules" "$GC_DEPS/app/node_modules"
export NODE_PATH="$GC_DEPS/node_modules"
export GC_BRIDGE_PROJECT_ROOT="$GC_ROOT"
case "$1" in
  check) exec "$GC_BUN" "$GC_ROOT/scripts/check.ts" ;;
  lint) exec "$GC_BUN" "$GC_ROOT/scripts/check.ts" lint ;;
  format) exec "$GC_BUN" "$GC_ROOT/scripts/check.ts" format ;;
esac
exec "$GC_BUN" "$GC_DEPS/app/src/entry.ts" "$@"
