# Dotfiles

Personal dotfiles for development environment setup.

## Repository layout

- `install_dotfiles.sh` - installer script (run this to link dotfiles)
- `dotfiles/` - source tree for dotfiles
	- `home/` - files placed here are linked into `$HOME` (e.g. `.bashrc`, `.profile`)
	- other directories (e.g. `bash/`, `conda/`, `git/`, `vim/`) are linked into `$XDG_CONFIG_HOME` (defaults to `~/.config`)

## Quick Start

```bash
# Clone
git clone https://github.com/HongmingLiang/dotfiles.git
cd dotfiles

# Make installer executable (only needed once)
chmod +x install_dotfiles.sh

# Preview what will happen (dry-run)
./install_dotfiles.sh --dry-run

# Perform the install (will backup and then create symlinks)
./install_dotfiles.sh
```

## Installer behavior and options

- Script: `install_dotfiles.sh`
- Options: `-n|--dry-run` to show actions without changing files; `-h|--help` for usage
- Backup: existing files (or dereferenced symlink targets) are moved/copied to `~/.dotfiles_backup/YYYYMMDD_HHMMSS/`
- A `backup-list.txt` is created in the backup directory summarizing moved items
- Linking rules:
	- Files under `dotfiles/home/` are linked into your `$HOME` as `~/FILENAME`
	- Each directory under `dotfiles/` (except `home`) is linked into `$XDG_CONFIG_HOME/<dirname>`
	- If a target already exists it will be backed up (or its dereferenced target copied) before replacing

After installation you may want to `source ~/.bashrc` or restart your shell.

## Adding or updating dotfiles

- To add a file that should live in your home (e.g. `.gitconfig`), place it in `dotfiles/home/`.
- To add an app config directory, create a directory under `dotfiles/` (e.g. `dotfiles/{app}/`) and put its config inside; it will be linked to `~/.config/{app}`.
- Re-run `./install_dotfiles.sh` to apply changes.

## Safety notes

- The installer attempts to be safe: it backs up existing files and supports a dry-run mode.
- Review the dry-run output before running the real install if you have important local changes.

## Troubleshooting

- If the script reports `dotfiles directory not found`, ensure you run it from the repository root or provide the correct path.
- If you need to restore from backup, inspect `~/.dotfiles_backup/YYYYMMDD_HHMMSS/` and move files back as needed.

---
Updated to match `install_dotfiles.sh` behavior (links, backups, dry-run). 