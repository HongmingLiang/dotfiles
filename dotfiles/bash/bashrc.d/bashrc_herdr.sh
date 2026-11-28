#!/usr/bin/env bash
# herdr helpers: small replacement for tmuxifier-style session layouts.
# Everything goes through the herdr CLI, so no extra tooling is needed.
if command -v herdr &> /dev/null; then
  alias hd="herdr"
  alias hls="herdr session list"

  # hkill [id|label]: close a workspace; picks one with fzf when omitted.
  hkill() {
    case "$1" in
      -h|--help)
        cat << 'EOF'
usage: hkill [id|label]

  hkill          pick a workspace with fzf and close it
  hkill dotfiles close the workspace whose label contains "dotfiles"
  hkill wD       close the workspace by id

  Closing goes through the CLI, so there is no extra confirmation.
EOF
        return 0
        ;;
    esac

    command -v jq &> /dev/null || { echo "hkill: jq is required" >&2; return 1; }

    local list id matches count
    list=$(herdr workspace list 2>/dev/null \
      | jq -r '.result.workspaces[] | "\(.workspace_id)\t\(.label)"')
    [ -n "$list" ] || { echo "hkill: no workspaces" >&2; return 1; }

    if [ -z "${1:-}" ]; then
      command -v fzf &> /dev/null || {
        printf '%s\n' "$list" | sed 's/\t/  /'
        echo "hkill: pass a workspace id or label" >&2
        return 1
      }
      id=$(printf '%s\n' "$list" \
        | fzf --delimiter='\t' --with-nth=2 --prompt='hkill> ' \
          --header='Enter close   Esc cancel' \
        | cut -f1)
      [ -n "$id" ] || return 0
    else
      id=$(printf '%s\n' "$list" | awk -F'\t' -v t="$1" '$1 == t { print $1 }')
      [ -n "$id" ] || id=$(printf '%s\n' "$list" | awk -F'\t' -v t="$1" '$2 == t { print $1 }')
      if [ -z "$id" ]; then
        matches=$(printf '%s\n' "$list" | awk -F'\t' -v t="$1" 'index($2, t) { print $1 "\t" $2 }')
        count=$(printf '%s\n' "$matches" | grep -c .)
        if [ "$count" -gt 1 ]; then
          echo "hkill: '$1' matches more than one workspace:" >&2
          printf '%s\n' "$matches" | sed 's/\t/  /' >&2
          return 1
        fi
        id=$(printf '%s\n' "$matches" | cut -f1)
      fi
      [ -n "$id" ] || { echo "hkill: no workspace matches '$1'" >&2; return 1; }
    fi

    local out
    if out=$(herdr workspace close "$id" 2>&1); then
      echo "hkill: closed $id"
    else
      echo "hkill: failed to close $id: $out" >&2
      return 1
    fi
  }

  # hload [name] [dir]: editor / agent / cli workspace for a project.
  # Reuses a workspace with the same label instead of creating a duplicate,
  # and attaches to herdr when called from a plain (detached) terminal.
  hload() {
    case "$1" in
      -h|--help)
        cat << 'EOF'
usage: hload [name] [dir]

  Create (or focus) a herdr workspace with three tabs:
    $EDITOR  the editor running in dir, named after the editor binary
    agent    empty shell, ready for an agent
    cli      shell

  dir/.venv is activated in the editor and cli tabs when it exists.
  name defaults to the basename of dir; dir defaults to $PWD.
  Called outside herdr, the script attaches to the session at the end.
EOF
        return 0
        ;;
    esac

    command -v jq &> /dev/null || { echo "hload: jq is required" >&2; return 1; }

    local dir="${2:-$PWD}"
    local name="${1:-$(basename "$dir")}"
    local editor="${EDITOR:-vim}"
    local editor_label
    editor_label=$(basename "${editor%% *}")
    local inside=0
    [ -n "${HERDR_PANE_ID:-}" ] && inside=1

    # From a plain terminal the server may be detached or not running at all.
    if [ "$inside" -eq 0 ] && ! herdr workspace list > /dev/null 2>&1; then
      herdr server > /dev/null 2>&1 &
      local tries=0
      until herdr workspace list > /dev/null 2>&1; do
        tries=$((tries + 1))
        [ "$tries" -ge 25 ] && break
        sleep 0.2
      done
    fi

    local existing created ws_id edit_tab edit_pane cli_pane venv_cmd="" edit_cmd="$editor"
    existing=$(herdr workspace list 2>/dev/null | jq -r --arg n "$name" \
      '.result.workspaces[]? | select(.label == $n) | .workspace_id' | head -n 1)
    if [ -d "$dir/.venv" ]; then
      venv_cmd="source .venv/bin/activate"
      edit_cmd="$venv_cmd && $editor"
    fi

    if [ -n "$existing" ]; then
      herdr workspace focus "$existing" > /dev/null && echo "hpreset: focused '$name'"
    else
      created=$(herdr workspace create --cwd "$dir" --label "$name" --no-focus) || return 1
      ws_id=$(printf '%s' "$created" | jq -r '.result.workspace.workspace_id')
      edit_tab=$(printf '%s' "$created" | jq -r '.result.tab.tab_id')
      edit_pane=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id')

      herdr tab rename "$edit_tab" "$editor_label" > /dev/null
      herdr tab create --workspace "$ws_id" --label agent --no-focus > /dev/null
      cli_pane=$(herdr tab create --workspace "$ws_id" --label cli --no-focus \
        | jq -r '.result.root_pane.pane_id')

      # let the fresh shells reach their prompt before typing into them
      sleep 0.4
      herdr pane run "$edit_pane" "$edit_cmd" > /dev/null
      [ -n "$venv_cmd" ] && herdr pane run "$cli_pane" "$venv_cmd" > /dev/null

      herdr workspace focus "$ws_id" > /dev/null
      herdr tab focus "$edit_tab" > /dev/null
      echo "hpreset: '$name' ready in $dir"
    fi

    # Detached call: jump straight into herdr on the workspace we just prepared.
    [ "$inside" -eq 0 ] && herdr
    return 0
  }
fi
