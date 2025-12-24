#!/usr/bin/env bash

# --- editor ---
if command -v nvim > /dev/null 2>&1; then
  export EDITOR=nvim
  alias vvim="$(which vim)"
  alias vim='nvim'
else
  export EDITOR=vim
  export VIMINIT="source $XDG_CONFIG_HOME/vim/vimrc"
fi
alias v="$EDITOR"

# shell prompt
if command -v starship > /dev/null 2>&1; then # starship
  export STARSHIP_CONFIG="$XDG_CONFIG_HOME/starship/starship.toml"
  eval "$(starship init bash)"
elif command -v git > /dev/null 2>&1; then # PS1 with Git branch info
  PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[01;33m\]$(git branch 2>/dev/null | sed -n "s/^\* \(.*\)/ (\1)/p")\[\033[00m\]\$ '
else
  PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
fi

# colorful output for ls and grep
if [ -x /usr/bin/dircolors ]; then
  test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
  alias ls='ls --color=auto'
  alias grep='grep --color=auto'
  alias fgrep='fgrep --color=auto'
  alias egrep='egrep --color=auto'
fi

# eza
if command -v eza > /dev/null 2>&1; then
  alias ls='eza --group --icons --git --group-directories-first'
fi

# aliases for ls
alias ll='ls -alhF'
alias la='ls -A'
alias l='ls -hF'

# fzf
if command -v fzf > /dev/null 2>&1; then
  eval "$(fzf --bash)" # Set up fzf key bindings and fuzzy completion
fi

# bat: better `cat`
if command -v bat > /dev/null 2>&1; then
  export BAT_CONFIG_PATH="$XDG_CONFIG_HOME/bat/config"
  export BAT_CONFIG_DIR="$XDG_CONFIG_HOME/bat"
  alias ccat="$(which cat)" # keep original cat accessible via ccat
  alias cat='bat --paging=never'
  alias catp='bat --paging=always'
  batdiff() { # show git diff with bat
    git diff --name-only --relative --diff-filter=d -z | xargs -0 bat --diff
  }
  help() { # help command with bat formatting
    "$@" --help 2>&1 | bat --plain --language=help
  }
fi

# dust: better `du`
if command -v dust > /dev/null 2>&1; then
  for i in {1..5}; do
    alias "du$i"="dust -d $i -p"
  done
  alias du="dust -p"
else
  for i in {1..5}; do
    alias "du$i"="du -hd $i"
  done
  alias du="du -h"
fi

# gping
if command -v gping > /dev/null 2>&1; then
  alias pping='$(which ping)' # keep original ping accessible via pping
  alias ping='gping'
fi

# yazi shell wrapper for changing directory: https://yazi-rs.github.io/docs/quick-start
function y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
  yazi "$@" --cwd-file="$tmp"
  IFS= read -r -d '' cwd < "$tmp"
  [ -n "$cwd" ] && [ "$cwd" != "$PWD" ] && builtin cd -- "$cwd"
  rm -f -- "$tmp"
}
alias yy='yazi'
