#!/usr/bin/env bash
# SSH host picker.
# Internal: use the fzf look & feel defined by FZF_DEFAULT_OPTS, add what this
# picker is about (host names, resolved target preview, key hints).
#
__fssh_usage() {
  cat << 'EOF'
usage: fssh [host] [ssh options...]

  fssh                  fuzzy-pick a host from ~/.ssh/config, then connect
  fssh myserver         skip the picker, connect to this host directly
  fssh -p 2222          extra ssh options are forwarded to ssh as-is

In the picker: type to filter, Enter to connect, Esc to cancel.
EOF
}

__fssh_pick() {
  fzf \
    --prompt='ssh> ' \
    --header='Enter connect   Esc cancel   Type to filter' \
    --border-label=' fssh ' \
    --input-label=' Filter ' \
    --header-label=' Keys ' \
    --list-label=' Hosts ' \
    --bind='result:transform-list-label:if [ -z "$FZF_QUERY" ]; then echo " $FZF_MATCH_COUNT hosts "; else echo " $FZF_MATCH_COUNT matches for [$FZF_QUERY] "; fi' \
    --bind='focus:transform-preview-label:printf " ssh -G %s " {}' \
    --preview="ssh -G {} 2>/dev/null | awk '/^(hostname|user|port|proxyjump|identityfile) / {printf \"\\033[1;35m%-13s\\033[0m %s\\n\", \$1, \$2}'"
}

# Internal: list every Host alias from the ssh client config (wildcards filtered).
__fssh_hosts() {
  grep -hiE '^[[:space:]]*Host[[:space:]]' \
    "$HOME/.ssh/config" "$HOME"/.ssh/config.d/* 2> /dev/null |
    sed 's/#.*//' |
    awk '{ for (i = 2; i <= NF; i++) print $i }' |
    grep -vE '[*?!]' |
    sort -u
}

fssh() {
  local host=""
  local -a ssh_opts=()

  if [ $# -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
    __fssh_usage
    return 0
  fi

  # Only a leading non-option argument is treated as the host; everything else
  # is passed through to ssh in order, so `fssh -p 2222` works as expected.
  if [ $# -gt 0 ] && [ "${1:0:1}" != "-" ]; then
    host=$1
    shift
  fi
  ssh_opts=("$@")

  if [ -z "$host" ]; then
    if ! command -v fzf > /dev/null 2>&1; then
      printf 'fssh: fzf not found, give the host directly: fssh <host>\n' >&2
      return 1
    fi

    local hosts
    hosts=$(__fssh_hosts)
    if [ -z "$hosts" ]; then
      printf 'fssh: no Host entries in %s\n' "${HOME}/.ssh/config" >&2
      return 1
    fi

    host=$(printf '%s\n' "$hosts" | __fssh_pick) || return 0
  fi
  [ -n "$host" ] || return 0

  ssh "${ssh_opts[@]}" "$host"
}

# Tab-complete host aliases: `fssh <TAB>`
__fssh_complete() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  COMPREPLY=($(compgen -W "$(__fssh_hosts)" -- "$cur"))
}
complete -F __fssh_complete fssh

case $- in
  *i*) bind -x '"\C-f\C-f": fssh' ;;
esac
