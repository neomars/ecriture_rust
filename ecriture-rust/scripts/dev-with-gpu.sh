#!/usr/bin/env bash
# Wraps `tauri dev`, running the same hardware detection as
# detect-gpu.sh first and passing the matching `--features gpu-*` flag
# through automatically. This is what `npm run start` calls: your normal
# day-to-day launch command already uses the GPU when this machine has
# one it can build against, with nothing to remember or type - the
# opt-in `--features` flags documented in the README are still there for
# anyone who wants to force a specific backend by hand (or force
# CPU-only with plain `npm run tauri dev`), but this is the default path.
#
# Extra arguments are forwarded to `tauri dev` as-is, e.g.:
#   npm run start -- --features some-other-thing
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(dirname "$script_dir")"
cd "$project_root"

feature="$("$script_dir/detect-gpu.sh" --feature)"

if [ -n "$feature" ]; then
    echo "[start] GPU detected - launching with --features $feature"
    exec npx tauri dev --features "$feature" "$@"
else
    echo "[start] No usable GPU detected - launching CPU-only"
    exec npx tauri dev "$@"
fi
