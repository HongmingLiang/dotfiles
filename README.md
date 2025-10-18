# Dotfiles

My personal dotfiles for development environment setup.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/HongmingLiang/dotfiles.git
cd dotfiles

# Run the install script (backs up existing files)
chmod +x install.sh
./install.sh
```
## Features

- ✅ Automatic backup of existing files
- ✅ Symlink-based setup
- ✅ No manual configuration needed
- ✅ Easy to extend with new dotfiles

## Backup Location

Existing files are backed up to `~/.dotfiles_backup/TIMESTAMP/`

## Adding New Dotfiles

Copy your config file to the dotfiles/ directory:

```bash
cp ~/.newconfig dotfiles/dotfiles/.newconfig
```
Run the install script again:
```bash
./install.sh
```
The script automatically detects new files and creates symlinks.