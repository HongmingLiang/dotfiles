#!/bin/bash
# Kanata macOS installer: render the plist templates with absolute paths, then
# deploy, load and verify the LaunchDaemons.
set -euo pipefail
IFS=$'\n\t'

# ---- Safety: refuse to run as root ----
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    echo "Do not run this script as root. It will use sudo where needed." >&2
    exit 1
fi

# ---- Temp file cleanup ----
TMP_FILES=()
cleanup() {
    local f
    for f in "${TMP_FILES[@]:-}"; do
        [ -n "$f" ] || continue
        if [ -d "$f" ]; then
            rm -rf "$f"
        elif [ -f "$f" ]; then
            rm -f "$f"
        fi
    done
}
trap cleanup EXIT

# ---- Colors & helpers ----
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || error "This script is for macOS only."

# ---- Required commands ----
for cmd in brew curl sudo launchctl installer pkgutil sed awk systemextensionsctl; do
    command -v "$cmd" >/dev/null 2>&1 || error "Required command not found: $cmd"
done

# ---- Paths & source validation ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/LaunchDaemons"
KANATA_CONFIG="$SCRIPT_DIR/kanata.kbd"
TRIM_SCRIPT="$SCRIPT_DIR/trim-logs.sh"
DRIVER_VERSION="v6.2.0"
DRIVER_PKGID="org.pqrs.Karabiner-DriverKit-VirtualHIDDevice"

# Private temp dir (under $TMPDIR, owned by this user) instead of a predictable
# path in the world-writable /tmp: nothing can pre-plant a symlink there and
# have root install whatever it points at.
DRIVER_TMP="$(mktemp -d)"
TMP_FILES+=("$DRIVER_TMP")
DRIVER_PKG="$DRIVER_TMP/Karabiner-DriverKit-VirtualHIDDevice.pkg"

# Logs live in /tmp, which macOS sweeps daily (only entries idle 3+ days).
# A daemon keeps its own log fresh, so log-trim bounds its size instead.
LOG_DIR="/tmp"
LOG_OUT="$LOG_DIR/kanata.out.log"
LOG_ERR="$LOG_DIR/kanata.err.log"

[ -f "$KANATA_CONFIG" ] || error "Config not found: $KANATA_CONFIG"
[ -x "$TRIM_SCRIPT" ]   || error "Log trim script not executable: $TRIM_SCRIPT"
[ -d "$PLIST_SRC" ]     || error "Plist dir not found: $PLIST_SRC"

for f in com.hmliang.kanata.plist \
         com.hmliang.kanata.log-trim.plist \
         com.hmliang.karabiner-vhiddaemon.plist \
         com.hmliang.karabiner-vhidmanager.plist; do
    [ -f "$PLIST_SRC/$f" ] || error "Missing template: $PLIST_SRC/$f"
done

# ============================================================
# 1. Install Kanata
# ============================================================
info "Installing Kanata via Homebrew..."
brew install kanata

KANATA_PREFIX="$(brew --prefix kanata 2>/dev/null)" || error "brew --prefix kanata failed"
KANATA_BIN="$KANATA_PREFIX/bin/kanata"
[ -x "$KANATA_BIN" ] || error "Kanata binary not executable: $KANATA_BIN"

# ============================================================
# 2. Install Karabiner driver
# ============================================================
DRIVER_WANTED="${DRIVER_VERSION#v}"
DRIVER_URL="https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases/download/${DRIVER_VERSION}/Karabiner-DriverKit-VirtualHIDDevice-${DRIVER_WANTED}.pkg"

# Skip re-installing the driver when the receipt shows it is already there:
# the pkg's postinstall kills our daemon and asks for the admin password again.
# FORCE_DRIVER=1 overrides.
DRIVER_INSTALLED_VER=""
if pkgutil --pkg-info "$DRIVER_PKGID" >/dev/null 2>&1; then
    DRIVER_INSTALLED_VER="$(pkgutil --pkg-info "$DRIVER_PKGID" 2>/dev/null | awk '/^version:/{print $2}')" || true
fi

if [ "${FORCE_DRIVER:-0}" != "1" ] && [ "$DRIVER_INSTALLED_VER" = "$DRIVER_WANTED" ]; then
    info "Karabiner driver ${DRIVER_INSTALLED_VER} already installed — skipping download/install"
    info "  (to re-install it anyway: FORCE_DRIVER=1 $0)"
else
    if [ -n "$DRIVER_INSTALLED_VER" ]; then
        info "Replacing Karabiner driver ${DRIVER_INSTALLED_VER} with ${DRIVER_WANTED}..."
    fi
    info "Downloading Karabiner driver ${DRIVER_VERSION}..."
    curl -fL "$DRIVER_URL" -o "$DRIVER_PKG" || error "Driver download failed"

    info "Installing driver (admin password required)..."
    sudo installer -pkg "$DRIVER_PKG" -target / || error "Driver install failed"
fi

info "Activating driver..."
sudo /Applications/.Karabiner-VirtualHIDDevice-Manager.app/Contents/MacOS/Karabiner-VirtualHIDDevice-Manager forceActivate 2>/dev/null || \
    warn "Driver activation may need manual approval in System Settings"

# ============================================================
# 3. Deploy LaunchDaemons
# ============================================================
info "Deploying LaunchDaemons (admin password required)..."

# The logs land in a world-writable directory, so pre-create them as root.
# Otherwise a leftover path — or a symlink another account planted — could
# redirect root's output somewhere else. Existing logs are never truncated.
prepare_log() {
    local f="$1"
    if [ -L "$f" ]; then
        warn "Removing unexpected symlink: $f"
        sudo rm -f "$f"
    fi
    [ -e "$f" ] || sudo install -m 644 -o root -g wheel /dev/null "$f"
}

prepare_log "$LOG_OUT"
prepare_log "$LOG_ERR"

# Render a plist template, substituting runtime paths, and install it atomically.
render_plist() {
    local src="$1" dst="$2"
    local tmp
    tmp="$(mktemp)"
    TMP_FILES+=("$tmp")

    # Paths here are user-home, Homebrew-prefix and /tmp based; none contain '|'.
    sed -e "s|__KANATA_BIN__|${KANATA_BIN}|g" \
        -e "s|__KANATA_CONFIG__|${KANATA_CONFIG}|g" \
        -e "s|__TRIM_SCRIPT__|${TRIM_SCRIPT}|g" \
        -e "s|__LOG_DIR__|${LOG_DIR}|g" \
        "$src" > "$tmp"

    # Verify substitution actually happened (fail-fast on typo'd placeholder)
    grep -qE '__[A-Z_]+__' "$tmp" && error "Unresolved placeholder in $src"

    sudo install -m 644 -o root -g wheel "$tmp" "$dst"
}

render_plist "$PLIST_SRC/com.hmliang.kanata.plist" \
             /Library/LaunchDaemons/com.hmliang.kanata.plist

render_plist "$PLIST_SRC/com.hmliang.kanata.log-trim.plist" \
             /Library/LaunchDaemons/com.hmliang.kanata.log-trim.plist

sudo install -m 644 -o root -g wheel \
    "$PLIST_SRC/com.hmliang.karabiner-vhiddaemon.plist" \
    /Library/LaunchDaemons/com.hmliang.karabiner-vhiddaemon.plist

sudo install -m 644 -o root -g wheel \
    "$PLIST_SRC/com.hmliang.karabiner-vhidmanager.plist" \
    /Library/LaunchDaemons/com.hmliang.karabiner-vhidmanager.plist

# ============================================================
# 4. Load services
# ============================================================
# bootout first so edited plists are re-read, then enable, then bootstrap
# (enable-first avoids "Bootstrap failed: 5").
load_daemon() {
    local label="$1" plist="/Library/LaunchDaemons/$1.plist"
    sudo launchctl bootout "system/$label" 2>/dev/null || true
    sudo launchctl enable  "system/$label" 2>/dev/null || true
    sudo launchctl bootstrap system "$plist" 2>/dev/null || true
}

info "Loading Karabiner HID daemon..."
load_daemon com.hmliang.karabiner-vhiddaemon

info "Loading Karabiner driver manager..."
load_daemon com.hmliang.karabiner-vhidmanager

info "Loading Kanata..."
load_daemon com.hmliang.kanata

info "Loading log trim guard..."
load_daemon com.hmliang.kanata.log-trim

sleep 2

# ============================================================
# 5. Verification
# ============================================================
echo ""
echo "============================================"
echo "  Verification"
echo "============================================"

# 5a. Driver extension
if systemextensionsctl list 2>/dev/null \
    | grep -q "org.pqrs.Karabiner-DriverKit-VirtualHIDDevice.*activated enabled"; then
    info "Driver extension: activated"
else
    warn "Driver extension: NOT activated (approve in System Settings)"
fi

# 5b. Services
# Long-running jobs must have a pid.
check_running() {
    local label="$1" out pid
    out="$(sudo launchctl print "system/$label" 2>/dev/null)" || {
        warn "$label: not loaded"
        return 1
    }
    pid="$(printf '%s\n' "$out" | awk -F' = ' '/pid =/{print $2; exit}')"
    if [ -n "${pid:-}" ] && [ "$pid" != "0" ]; then
        info "$label: running (pid $pid)"
        return 0
    fi
    warn "$label: loaded but not running"
    return 1
}

# One-shot jobs (dext activation, log maintenance) have already exited by the
# time we look, so "no pid" is their normal state — judge them by exit code, and
# treat a job whose first run has not finished yet as healthy.
check_oneshot() {
    local label="$1" out code
    out="$(sudo launchctl print "system/$label" 2>/dev/null)" || {
        warn "$label: not loaded"
        return 1
    }
    code="$(printf '%s\n' "$out" | awk -F' = ' '/last exit code =/{print $2; exit}')"
    case "${code:-none}" in
        0)    info "$label: loaded, last run succeeded" ;;
        none) info "$label: loaded, first run still in progress" ;;
        *)    warn "$label: loaded, last exit code $code"
              return 1 ;;
    esac
    return 0
}

FAILED=0
check_running com.hmliang.karabiner-vhiddaemon || FAILED=1
check_running com.hmliang.kanata                || FAILED=1
check_oneshot com.hmliang.karabiner-vhidmanager || FAILED=1
check_oneshot com.hmliang.kanata.log-trim       || FAILED=1

# On a first install kanata stays down until the user approves the Input
# Monitoring and Accessibility grants; macOS requires a human there and no
# script can stand in. So just print the exact path the daemon execs.
PERM_ISSUE=""
if [ "$FAILED" -ne 0 ] && [ -f "$LOG_ERR" ] && \
   grep -Eq 'needs macOS (Input Monitoring|Accessibility) permission|\(iokit/common\) not permitted' "$LOG_ERR"; then
    PERM_ISSUE=1
fi

if [ -n "$PERM_ISSUE" ]; then
    echo ""
    warn "kanata is not remapping yet: macOS is waiting for you to grant Input"
    warn "Monitoring + Accessibility. It retries every ~10s and starts on its own"
    warn "once the grants exist — nothing else has to be restarted."
    echo ""
    if printf '%s' "$KANATA_BIN" | pbcopy 2>/dev/null; then
        info "Copied to the clipboard: ${KANATA_BIN} (replaces its previous content)"
    else
        warn "Could not copy to the clipboard, use this path: ${KANATA_BIN}"
    fi
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
    sleep 1
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent" 2>/dev/null || true
    echo "    In each pane: ＋  then  ⇧⌘G  then  ⌘V  then Return, and switch it on."
elif [ "$FAILED" -ne 0 ]; then
    echo ""
    warn "Some services failed. Last 30 lines of ${LOG_ERR}:"
    sudo tail -n 30 "$LOG_ERR" 2>/dev/null || echo "  (log not found)"
fi

# ============================================================
# 6. Manual steps
# ============================================================
echo ""
echo "============================================"
echo "  Manual Steps Required"
echo "============================================"
echo ""
echo "1. Input Monitoring:"
echo "   System Settings > Privacy & Security > Input Monitoring"
echo "   Add: ${KANATA_BIN}"
echo ""
echo "2. Accessibility:"
echo "   System Settings > Privacy & Security > Accessibility"
echo "   Add: ${KANATA_BIN}"
if [ -n "${PERM_ISSUE:-}" ]; then
    echo "   (both panes were just opened and the path is in your clipboard:"
    echo "    click ＋, press ⇧⌘G, paste with ⌘V, Return, then switch the entry on)"
fi
echo ""
echo "3. System Extension:"
echo "   System Settings > General > Login Items & Extensions"
echo "   Enable: org.pqrs.Karabiner-DriverKit-VirtualHIDDevice"
echo "   (com.hmliang.karabiner-vhidmanager re-activates it at every boot; after"
echo "    a macOS major upgrade the extension may need approval again)"
echo ""
echo "4. After 'brew upgrade kanata':"
echo "   kanata is ad-hoc signed and lives in a versioned Cellar path, so a new"
echo "   build is a new TCC subject and both grants stop applying to it. Then:"
echo "     sudo launchctl kickstart -k system/com.hmliang.kanata   # start the new binary"
echo "     sudo kanata --list                        # must list your keyboards"
echo "   If it does not list them, re-grant (the daemon registers itself at startup,"
echo "   so it should appear in the panes): System Settings > Privacy & Security >"
echo "   Input Monitoring + Accessibility > remove the stale kanata entry > add back:"
echo "     ${KANATA_BIN}"
echo "   Accessibility half can also be refreshed with: kanata --macos-request-permissions"
echo ""
echo "Config:  ${KANATA_CONFIG}"
echo "Logs:    ${LOG_OUT}"
echo "         ${LOG_ERR}"
echo "         (parked in /tmp so macOS reaps them once kanata stops writing;"
echo "          while it runs they are trimmed to the last 1 MiB past 10 MiB)"
echo "Services: com.hmliang.kanata            kanata itself (restart on crash)"
echo "          com.hmliang.karabiner-vhiddaemon  HID injection (required)"
echo "          com.hmliang.karabiner-vhidmanager dext activation (one-shot)"
echo "          com.hmliang.kanata.log-trim       log size guard (every 3 days)"
echo "Reload:  sudo launchctl kickstart -k system/com.hmliang.kanata"
echo "Stop:    LCtrl+Space+Esc (emergency exit; a clean exit is not restarted)"
echo "Test:    sudo ${KANATA_BIN} -c ${KANATA_CONFIG}"
echo ""
