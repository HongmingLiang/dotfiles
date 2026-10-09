#!/bin/bash
# Kanata log guard (macOS): keep the launchd logs from growing forever.
# /tmp is swept daily, but only for entries idle 3+ days, and an appending
# daemon never ages out. Truncating in place is safe because launchd opens
# these logs with O_APPEND. Run as root by com.hmliang.kanata.log-trim.
# Usage: trim-logs.sh [logfile ...]
set -euo pipefail
IFS=$'\n\t'

# Trim once a log exceeds MAX_BYTES, keeping the newest KEEP_BYTES.
MAX_BYTES="${MAX_BYTES:-10485760}"  # 10 MiB
KEEP_BYTES="${KEEP_BYTES:-1048576}" # 1 MiB

# Don't touch a file macOS is about to reap: tmp_cleaner deletes /tmp entries
# idle for 3+ days, and rewriting one here would reset that clock.
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
