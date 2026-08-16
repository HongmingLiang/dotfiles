#!/bin/bash

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_SRC="$DOTFILES_DIR/dotfiles"
DOTFILES_HOME="$DOTFILES_SRC/home"

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
XDG_BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"

BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"

# parse args
DRY_RUN=0
NO_BACKUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    -n | --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-backup)
      NO_BACKUP=1
      shift
      ;;
    -h | --help)
      echo "Usage: $0 [--dry-run] [--no-backup]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      shift
      ;;
  esac
done

echo "=== Dotfiles Installer ==="
[ ! -d "$DOTFILES_SRC" ] && echo "Error: dotfiles directory not found: $DOTFILES_SRC" && exit 1

echo "Installing dotfiles..."
if [ "$NO_BACKUP" -eq 1 ]; then
  echo "Backup: disabled"
else
  echo "Backup: $BACKUP_DIR"
fi

info() { echo "$@"; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[DRY]'
    printf ' %q' "$@"
    echo
    return 0
  fi
  "$@"
}

backup_log() {
  [ "$NO_BACKUP" -eq 1 ] && return
  [ "$DRY_RUN" -eq 1 ] && {
    echo "[DRY] log: $1"
    return
  }
  echo "$1" >> "$BACKUP_DIR/backup-list.txt"
}

if [ "$NO_BACKUP" -eq 0 ]; then
  run mkdir -p "$BACKUP_DIR"
fi
run mkdir -p "$XDG_BIN_HOME"
run mkdir -p "$XDG_DATA_HOME/bash"

# 1) Link files from DOTFILES_HOME into $HOME
if [ -d "$DOTFILES_HOME" ]; then
  for file in "$DOTFILES_HOME"/* "$DOTFILES_HOME"/.*; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    [[ "$filename" == "." || "$filename" == ".." ]] && continue

    target="$HOME/$filename"
    if [ -L "$target" ]; then
      real=$(readlink -f "$target" 2> /dev/null || true)
      if [ "$NO_BACKUP" -eq 1 ]; then
        info "Removing existing symlink without backup: $target"
      elif [ -n "$real" ] && [ -e "$real" ]; then
        info "Backed up dereferenced target: $real -> $BACKUP_DIR/"
        run cp -a "$real" "$BACKUP_DIR/"
        backup_log "deref: $target -> $real"
      else
        info "Backed up broken symlink: $target"
        run mv "$target" "$BACKUP_DIR/"
        backup_log "link: $target"
      fi
      run rm -f "$target"
    elif [ -e "$target" ]; then
      if [ "$NO_BACKUP" -eq 1 ]; then
        info "Removing existing target without backup: $target"
        run rm -rf "$target"
      else
        info "Backed up: $target"
        run mv "$target" "$BACKUP_DIR/"
        backup_log "move: $target"
      fi
    fi
    run ln -sfn "$file" "$target"
    info "Linked home: $filename -> $target"
  done
fi

# 2) Link directories (except 'home') into XDG config directory
run mkdir -p "$XDG_CONFIG_HOME"
for dir in "$DOTFILES_SRC"/*; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ "$name" == "$(basename "$DOTFILES_HOME")" ] && continue

  target="$XDG_CONFIG_HOME/$name"
  if [ -L "$target" ]; then
    real=$(readlink -f "$target" 2> /dev/null || true)
    if [ "$NO_BACKUP" -eq 1 ]; then
      info "Removing existing symlink without backup: $target"
    elif [ -n "$real" ] && [ -e "$real" ]; then
      info "Backed up dereferenced target: $real -> $BACKUP_DIR/"
      run cp -a "$real" "$BACKUP_DIR/"
      backup_log "deref: $target -> $real"
    else
      info "Backed up broken symlink: $target"
      run mv "$target" "$BACKUP_DIR/"
      backup_log "link: $target"
    fi
    run rm -f "$target"
  elif [ -e "$target" ]; then
    if [ "$NO_BACKUP" -eq 1 ]; then
      info "Removing existing target without backup: $target"
      run rm -rf "$target"
    else
      info "Backed up: $target"
      run mv "$target" "$BACKUP_DIR/"
      backup_log "move: $target"
    fi
  fi
  run ln -sfn "$dir" "$target"
  info "Linked dir: $name -> $target"
done

run "$DOTFILES_HOME/.pi/apply-pi-settings.sh"

info "=== Installation Complete! ==="
info "Run: source ~/.bashrc"
