#!/usr/bin/env bash

# exit
alias e='exit'

# source
alias so='source'
alias sobash='source ~/.bashrc'
alias soprofile='source ~/.profile'
alias sovenv='source .venv/bin/activate'
# Reload the shell config: Ctrl-X Ctrl-B.
# A readline macro, not `bind -x`: re-sourcing from the raw tty of a key-bound
# command makes starship's PS0/DEBUG hooks leak bytes before the next command.
# \C-a\C-k clears the current line first (it goes to the kill ring).
bind '"\C-x\C-b": "\C-a\C-ksource ~/.bashrc\C-m"'

# clear screen
alias clr='clear'

# disk usage
alias df='df -h'

# general process searching
alias psg='ps aux | grep -v grep | grep -i -e VSZ -e'

# git
alias g='git'
alias gs='git status'
alias gd='git diff'
alias ga='git add'
alias gc='git commit'
alias gl='git log --oneline'
alias gf='git fetch'
alias gu='git pull --rebase'
alias gp='git push'
alias gcl='git clone'
# lazygit
alias lg='lazygit'

# docker
alias d='docker'
alias dc='docker compose'

# tree
for i in {1..5}; do
  alias "tree$i"="tree -alC -L $i -I '.git'"
done


# python
alias py='python3'
alias pyhton='python'

# get web server headers
alias header='curl -I'

# macOS ships BSD ps: the `f` (forest) flag of procps-ng is Linux-only, so
# `ps auxf` fails with "illegal option -- f". The column positions of `ps aux`
# are the same on both, so only `f` has to go.
if [ "$(uname -s)" = Darwin ]; then
  # memory / cpu
  alias free='vm_stat'
  alias meminfo='top -l 1 -o mem -n 10'
  alias cpuinfo='sysctl -n machdep.cpu.brand_string'
  alias gpuinfo='system_profiler SPDisplaysDataType'

  # get top process eating memory
  alias psmem='ps aux | sort -nr -k 4'
  alias psmem10='ps aux | sort -nr -k 4 | head -10'

  # get top process eating cpu
  alias pscpu='ps aux | sort -nr -k 3'
  alias pscpu10='ps aux | sort -nr -k 3 | head -10'
else
  # memory / cpu
  alias free='free -h'
  # pass options to free
  alias meminfo='free -m -l -t'
  # Get server cpu info
  alias cpuinfo='lscpu'
  # nvidia-smi
  alias gpuinfo='nvidia-smi'
  alias nvismi='nvidia-smi'

  # get top process eating memory
  alias psmem='ps auxf | sort -nr -k 4'
  alias psmem10='ps auxf | sort -nr -k 4 | head -10'

  # get top process eating cpu
  alias pscpu='ps auxf | sort -nr -k 3'
  alias pscpu10='ps auxf | sort -nr -k 3 | head -10'
fi
