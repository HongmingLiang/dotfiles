#!/usr/bin/env bash

# exit
alias e='exit'

# source
alias so='source'
alias sobash='source ~/.bashrc'
alias soprofile='source ~/.profile'
alias sovenv='source .venv/bin/activate'

# clear screen
alias clr='clear'

# disk and memory usage
alias df='df -h'
alias free='free -h'

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

# nvidia-smi
alias gpuinfo="nvidia-smi"
alias nvismi="nvidia-smi"

# python
alias py='python3'
alias pyhton='python'

# get web server headers
alias header='curl -I'

# pass options to free
alias meminfo='free -m -l -t'

# get top process eating memory
alias psmem='ps auxf | sort -nr -k 4'
alias psmem10='ps auxf | sort -nr -k 4 | head -10'

# get top process eating cpu
alias pscpu='ps auxf | sort -nr -k 3'
alias pscpu10='ps auxf | sort -nr -k 3 | head -10'

# Get server cpu info
alias cpuinfo='lscpu'
