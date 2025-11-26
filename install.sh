#!/bin/bash

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_SRC="$DOTFILES_DIR/dotfiles"
DOTFILES_HOME="$DOTFILES_SRC/home"

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"

BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"

# parse args
DRY_RUN=0
while [ $# -gt 0 ]; do
    case "$1" in
        -n|--dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run]"
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
echo "Backup: $BACKUP_DIR"

# exec_cmd: unified command executor that supports dry-run and safe arg passing
exec_cmd() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[DRY]'
        printf ' %q' "$@"
        echo
    else
        "$@"
    fi
}

append_backup_list() {
    local line="$1"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "[DRY] append to $BACKUP_DIR/backup-list.txt: $line"
    else
        printf '%s\n' "$line" >> "$BACKUP_DIR/backup-list.txt"
    fi
}

exec_cmd mkdir -p "$BACKUP_DIR" # create backup dir
exec_cmd mkdir -p "$HOME/.local/bin" # mkdir for local bin directory
exec_cmd mkdir -p "$XDG_DATA_HOME/bash" # mkdir for bash history file

# initialize backup list (dry-run prints, real run truncates/creates file)
if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY] create/empty $BACKUP_DIR/backup-list.txt"
else
    echo "" > "$BACKUP_DIR/backup-list.txt"
fi

# 1) Link files from DOTFILES_HOME into $HOME
if [ -d "$DOTFILES_HOME" ]; then
    for file in "$DOTFILES_HOME"/* "$DOTFILES_HOME"/.*; do
        [ -e "$file" ] || continue
        filename=$(basename "$file")
        [[ "$filename" == "." || "$filename" == ".." ]] && continue

        target="$HOME/$filename"
        # If target is a symlink, back up its target (dereference) by copying the target content
        if [ -L "$target" ]; then
            real=$(readlink -f "$target" 2>/dev/null || true)
            if [ -n "$real" ] && [ -e "$real" ]; then
                exec_cmd cp -a "$real" "$BACKUP_DIR/" && echo "Backed up dereferenced target: $real -> $BACKUP_DIR/"
                append_backup_list "deref: $target -> $real"
            else
                exec_cmd mv "$target" "$BACKUP_DIR/" && echo "Backed up broken symlink: $target"
                append_backup_list "link: $target"
            fi
            exec_cmd rm -f "$target"
        elif [ -e "$target" ]; then
            exec_cmd mv "$target" "$BACKUP_DIR/" && echo "Backed up: $target"
            append_backup_list "move: $target"
        fi
        exec_cmd ln -sfn "$file" "$target"
        echo "Linked home: $filename -> $target"
    done
fi

# 2) Link directories (except 'home') into XDG config directory
exec_cmd mkdir -p "$XDG_CONFIG_HOME"
for dir in "$DOTFILES_SRC"/*; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" == "$(basename "$DOTFILES_HOME")" ] && continue

    target="$XDG_CONFIG_HOME/$name"
    # If target exists and is a symlink, back up its target content (dereference)
    if [ -L "$target" ]; then
        real=$(readlink -f "$target" 2>/dev/null || true)
        if [ -n "$real" ] && [ -e "$real" ]; then
            exec_cmd cp -a "$real" "$BACKUP_DIR/" && echo "Backed up dereferenced target: $real -> $BACKUP_DIR/"
            append_backup_list "deref: $target -> $real"
        else
            exec_cmd mv "$target" "$BACKUP_DIR/" && echo "Backed up broken symlink: $target"
            append_backup_list "link: $target"
        fi
        exec_cmd rm -f "$target"
    elif [ -e "$target" ]; then
        exec_cmd mv "$target" "$BACKUP_DIR/" && echo "Backed up: $target"
        append_backup_list "move: $target"
    fi
    exec_cmd ln -sfn "$dir" "$target"
    echo "Linked dir: $name -> $target"
done

echo "Installation complete!"
echo "Run: source ~/.bashrc"
