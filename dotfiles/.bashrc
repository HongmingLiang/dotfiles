# ~/.bashrc
# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

export EDITOR=vim

export LC_ALL=C.UTF-8
export LANG=C.UTF-8
export LANGUAGE=C.UTF-8

# History settings
HISTIGNORE="ls:ll:cd:pwd:exit:history"
HISTCONTROL=ignoreboth
HISTSIZE=1000
HISTFILESIZE=2000
shopt -s histappend
shopt -s checkwinsize

# aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi
if [ -f ~/.bash_aliases ]; then
    source ~/.bash_aliases
fi

# PS1 with Git branch info
if command -v git >/dev/null 2>&1; then
    PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[01;33m\]$(git branch 2>/dev/null | sed -n "s/^\* \(.*\)/ (\1)/p")\[\033[00m\]\$ '
else
    PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
fi

# ===================== add tools to PATH =====================

# >>> conda initialize >>>
for conda_prefix in "$HOME/miniforge3" "$HOME/miniconda3" "$HOME/anaconda3"; do # if conda isn't installed in one of these, adjust accordingly
    if [ -f "$conda_prefix/bin/conda" ]; then
        __conda_setup="$("$conda_prefix/bin/conda" 'shell.bash' 'hook' 2> /dev/null)"
        if [ $? -eq 0 ]; then
            eval "$__conda_setup"
        else
            [ -f "$conda_prefix/etc/profile.d/conda.sh" ] && . "$conda_prefix/etc/profile.d/conda.sh" || export PATH="$conda_prefix/bin:$PATH"
        fi
        unset __conda_setup
        break
    fi
done
unset conda_prefix
# <<< conda initialize <<<

# >>> mamba initialize >>>
for mamba_prefix in "$HOME/miniforge3" "$HOME/miniconda3"; do # if mamba isn't installed in one of these, adjust accordingly
    if [ -f "$mamba_prefix/bin/mamba" ]; then
        export MAMBA_EXE="$mamba_prefix/bin/mamba"
        export MAMBA_ROOT_PREFIX="$mamba_prefix"
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
unset mamba_prefix
# <<< mamba initialize <<<

# --- texlive  ---
for tex_year in "2027" "2026" "2025" "2024" "2023"; do
    if [ -d "/usr/local/texlive/$tex_year/bin/x86_64-linux" ]; then
        export PATH="/usr/local/texlive/$tex_year/bin/x86_64-linux:$PATH"
        export MANPATH="/usr/local/texlive/$tex_year/texmf-dist/doc/man:$MANPATH"
        export INFOPATH="/usr/local/texlive/$tex_year/texmf-dist/doc/info:$INFOPATH"
        break
    fi
done
unset tex_year
