#!/usr/bin/env bash

conda() { _lazy_conda_init conda "$@"; }
mamba() { _lazy_conda_init mamba "$@"; }

_lazy_conda_init() {
  unset -f conda mamba _lazy_conda_init # unset functions

  # >>> conda initialize >>>
  # if conda isn't installed in one of these, adjust accordingly. Or create symbolic links.
  for __conda_prefix in "$HOME/miniforge3" "$HOME/miniconda3" "$HOME/anaconda3"; do
    if [ -f "$__conda_prefix/bin/conda" ]; then
      __conda_setup="$("$__conda_prefix/bin/conda" 'shell.bash' 'hook' 2> /dev/null)"
      if [ $? -eq 0 ]; then
        eval "$__conda_setup"
      else
        [ -f "$__conda_prefix/etc/profile.d/conda.sh" ] && . "$__conda_prefix/etc/profile.d/conda.sh" || export PATH="$__conda_prefix/bin:$PATH"
      fi
      unset __conda_setup
      break
    fi
  done
  unset __conda_prefix
  # <<< conda initialize <<<

  # >>> mamba initialize >>>
  for __mamba_prefix in "$HOME/miniforge3" "$HOME/miniconda3"; do # if mamba isn't installed in one of these, adjust accordingly
    if [ -f "$__mamba_prefix/bin/mamba" ]; then
      export MAMBA_EXE="$__mamba_prefix/bin/mamba"
      export MAMBA_ROOT_PREFIX="$__mamba_prefix"
      __mamba_setup="$("$MAMBA_EXE" shell hook --shell bash --root-prefix "$MAMBA_ROOT_PREFIX" 2> /dev/null)"
      if [ $? -eq 0 ]; then
        eval "$__mamba_setup"
      else
        alias mamba="$MAMBA_EXE"
      fi
      unset __mamba_setup
      break
    fi
  done
  unset __mamba_prefix
  # <<< mamba initialize <<<

  if command -v mamba &> /dev/null; then
    alias cconda="$(which conda)" # keep conda accessible via cconda
    alias conda='mamba'
  fi
  "$@" # now run the requested command
}
# aliases for conda/mamba
alias ma='mamba'
alias co='conda'
alias coa='conda activate'
alias maa='mamba activate'
alias cod='conda deactivate'
alias mad='mamba deactivate'
alias coe='conda env'
alias mae='mamba env'
