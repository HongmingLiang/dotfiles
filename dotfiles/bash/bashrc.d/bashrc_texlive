#!/usr/bin/env bash

for tex_year in "2027" "2026" "2025" "2024" "2023"; do
  if [ -d "/usr/local/texlive/$tex_year/bin/x86_64-linux" ]; then
    export PATH="/usr/local/texlive/$tex_year/bin/x86_64-linux:$PATH"
    export MANPATH="/usr/local/texlive/$tex_year/texmf-dist/doc/man:$MANPATH"
    export INFOPATH="/usr/local/texlive/$tex_year/texmf-dist/doc/info:$INFOPATH"
    break
  fi
done
unset tex_year
