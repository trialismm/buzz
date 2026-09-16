#!/usr/bin/env bash
# Build this checkout's desktop app (unsigned, no auto-updater) and install it
# as /Applications/Buzz.app, replacing whatever is there (the old bundle goes
# to the Trash). Fork-local convenience for running the fork day to day.
#
#   scripts/install-local-desktop.sh                 # build + install + relaunch
#   scripts/install-local-desktop.sh --no-launch
#   scripts/install-local-desktop.sh --install-only  # reuse the last build
set -euo pipefail
LAUNCH=1; BUILD=1
for arg in "$@"; do
    case "$arg" in
        --no-launch) LAUNCH=0 ;;
        --install-only) BUILD=0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="$ROOT/bin:$PATH"

TARGET=$(rustc -vV | sed -n 's|host: ||p')
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")
SIDECARS=(buzz-acp buzz-agent buzz-backend-kubernetes buzz-dev-mcp git-credential-nostr buzz)
PACKAGES=(buzz-acp buzz-agent buzz-backend-kubernetes buzz-dev-mcp git-credential-nostr buzz-cli)

if [[ "$BUILD" == 1 ]]; then
echo "==> release sidecars"
cargo build --release $(printf -- '-p %s ' "${PACKAGES[@]}")
mkdir -p desktop/src-tauri/binaries
for bin in "${SIDECARS[@]}"; do
    cp "${TARGET_DIR}/release/${bin}" "desktop/src-tauri/binaries/${bin}-${TARGET}"
    chmod +x "desktop/src-tauri/binaries/${bin}-${TARGET}"
done

echo "==> desktop bundle"
cd desktop
[[ -d node_modules ]] || pnpm install
FEATURES=()
if [[ "${BUZZ_LOCAL_MESH:-1}" == "1" ]]; then FEATURES=(--features mesh-llm); fi
pnpm exec tauri build ${FEATURES[@]+"${FEATURES[@]}"} --target "$TARGET" --bundles app
cd "$ROOT"
fi
# The desktop crate keeps its own target dir; check it before the workspace one.
APP=""
for candidate in \
    "$ROOT/desktop/src-tauri/target/${TARGET}/release/bundle/macos/Buzz.app" \
    "$ROOT/desktop/src-tauri/target/release/bundle/macos/Buzz.app" \
    "${TARGET_DIR}/${TARGET}/release/bundle/macos/Buzz.app" \
    "${TARGET_DIR}/release/bundle/macos/Buzz.app"; do
    [[ -d "$candidate" ]] && { APP="$candidate"; break; }
done
[[ -n "$APP" ]] || { echo "no Buzz.app bundle found" >&2; exit 1; }
echo "built: $APP"

echo "==> install"
if pgrep -x Buzz >/dev/null 2>&1; then
    osascript -e 'tell application "Buzz" to quit' || true
    for _ in $(seq 1 30); do pgrep -x Buzz >/dev/null 2>&1 || break; sleep 1; done
fi
if [[ -d /Applications/Buzz.app ]]; then
    # Finder owns the Trash; fall back to a sibling rename if it refuses.
    if osascript -e 'tell application "Finder" to delete POSIX file "/Applications/Buzz.app"' >/dev/null 2>&1; then
        echo "previous app moved to the Trash"
    else
        STAMP=$(date +%Y%m%d-%H%M%S)
        mv /Applications/Buzz.app "/Applications/Buzz-previous-${STAMP}.app"
        echo "previous app kept as /Applications/Buzz-previous-${STAMP}.app"
    fi
fi
ditto "$APP" /Applications/Buzz.app
xattr -dr com.apple.quarantine /Applications/Buzz.app 2>/dev/null || true
echo "installed /Applications/Buzz.app ($(defaults read /Applications/Buzz.app/Contents/Info.plist CFBundleShortVersionString))"
if [[ "$LAUNCH" == 1 ]]; then
    open -a /Applications/Buzz.app
fi
