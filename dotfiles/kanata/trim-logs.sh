#!/bin/bash
# ============================================================
# Kanata log guard (macOS)
# - Bounds the size of kanata's launchd-managed logs, keeping the
#   newest bytes as context instead of wiping everything.
# - Why a guard is needed: /tmp is swept daily by
#   /usr/libexec/tmp_cleaner, but it only deletes files whose
#   atime/mtime/ctime are all older than 3 days. A daemon that
#   keeps appending refreshes mtime/ctime forever, so an
#   actively written log never ages out.
# - Why in-place truncation is safe: launchd opens
#   StandardOutPath/StandardErrorPath with O_APPEND, so after
#   `cat tmp > log` the daemon keeps appending at the new EOF
#   rather than writing into a hole (verified on macOS 26.6).
# - Intended to be run by the com.hmliang.kanata.log-trim LaunchDaemon as
#   root. Usage: trim-logs.sh [logfile ...]
# ============================================================
set -euo pipefail
IFS=$'\n\t'

# Trim once a log exceeds MAX_BYTES, keeping the newest KEEP_BYTES.
MAX_BYTES="${MAX_BYTES:-10485760}"  # 10 MiB
KEEP_BYTES="${KEEP_BYTES:-1048576}" # 1 MiB

# Leave a file alone once macOS is about to reap it: com.apple.tmp_cleaner
# deletes /tmp entries idle for 3+ days, and rewriting one here would reset that
# clock. Matches tmp_cleaner's daily_clean_tmps_days=3.
IDLE_SECONDS="${IDLE_SECONDS:-259200}" # 3 days

# launchd calls this with no arguments.
[ "$#" -gt 0 ] || set -- /tmp/kanata.out.log /tmp/kanata.err.log

for log in "$@"; do
    # Skip symlinks: /tmp is world-writable, so never follow one as root.
    if [ -L "$log" ] || [ ! -f "$log" ]; then
        continue
    fi

    # The file can disappear between the checks (kanata restarting, tmp_cleaner),
    # so treat a failed stat as "nothing to do" instead of aborting the run.
    size="$(stat -f %z "$log" 2>/dev/null)" || continue
    [ "$size" -gt "$MAX_BYTES" ] || continue

    # Hand idle logs over to the OS instead of reviving them.
    mtime="$(stat -f %m "$log" 2>/dev/null)" || continue
    [ "$(( $(date +%s) - mtime ))" -lt "$IDLE_SECONDS" ] || continue

    # Keep the tail in a private root-only file, then rewrite the original
    # in place. Same inode => the daemon's already-open fd stays valid.
    tmp="$(mktemp "${log}.XXXXXX")"
    tail -c "$KEEP_BYTES" "$log" > "$tmp"
    cat "$tmp" > "$log"
    rm -f "$tmp"

    printf 'trimmed %s: %s -> %s bytes\n' "$log" "$size" "$(stat -f %z "$log")"
done

exit 0
