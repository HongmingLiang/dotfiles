#!/bin/bash

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_SRC="$DOTFILES_DIR/dotfiles"
BACKUP_DIR="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"

echo "=== Dotfiles Installer ==="
[ ! -d "$DOTFILES_SRC" ] && echo "Error: dotfiles directory not found" && exit 1

mkdir -p "$BACKUP_DIR"
echo "Installing dotfiles..."
echo "Backup: $BACKUP_DIR"

for file in "$DOTFILES_SRC"/* "$DOTFILES_SRC"/.*; do
    [ -e "$file" ] || continue
    
    filename=$(basename "$file")
    [[ "$filename" == "." || "$filename" == ".." ]] && continue
    
    target="$HOME/$filename"
    
    # Backup if regular file/directory
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        mv "$target" "$BACKUP_DIR/" 2>/dev/null && echo "Backed up: $filename"
    fi
    
    # Remove if symlink exists
    [ -L "$target" ] && rm "$target"
    
    # Create new symlink
    ln -sf "$file" "$target"
    echo "Linked: $filename"
done

echo "Installation complete!"
echo "Run: source ~/.bashrc"