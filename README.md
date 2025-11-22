# Dotfiles & App Installer

Personal workstation setup: dotfiles linker with backups and a Python-based app installer (Homebrew or Miniforge/Mamba).

## Features

- Safe symlink installer to `$HOME` and `$XDG_CONFIG_HOME` with automatic backups
- Batch install of CLI/dev tools via Python (using Homebrew or Miniforge/Mamba as package manager)
- Auto-detect and install Git on major Linux distributions
- Clear structure for `bash`, `vim`, `yazi`, `lazygit`, etc.
- Install by list: `minimal`, `optional`, or `full`
- Dry-run preview and timestamped backup dir: `~/.dotfiles_backup/<timestamp>`

## Repository Layout

```plaintext
dotfiles/
├── README.md
├── dotfiles               # Source of all configs
│   ├── home                 # Linked directly to $HOME
│   └── ...                  # Linked to $XDG_CONFIG_HOME
├── install_apps           # Python app installer
│   ├── app_lists            # App lists (*.txt)
│   │   ├── minimal.txt        # Base set: vim, fzf, yazi, ...
│   │   └── optional.txt       # Extras: tmux, lazygit, neovim
│   ├── core                 # Environment, package managers, registry
│   ├── utils                # Git check/installer
│   └── install.py           # Entry point
└── install_dotfiles.sh    # Symlink & backup installer
```

## Quick Start (Dotfiles)

```bash
git clone https://github.com/HongmingLiang/dotfiles.git ~/dotfiles
cd ~/dotfiles

# Make executable (first time only)
chmod +x install_dotfiles.sh

# Preview actions (no changes)
./install_dotfiles.sh --dry-run

# Perform install (backs up, then creates symlinks)
./install_dotfiles.sh

# Refresh shell session
source ~/.bashrc
```

### Installer Behavior

- Options: `-n|--dry-run` to preview; `-h|--help` for usage
- Backups: existing files or dereferenced symlink targets go to `~/.dotfiles_backup/<timestamp>/`
- Backup summary: `backup-list.txt` is written in the backup directory
- Linking rules:
	- `dotfiles/home/*` → `$HOME/<same name>`
	- other top-level dirs under `dotfiles/` (except `home`) → `$XDG_CONFIG_HOME/<dirname>` (defaults to `~/.config`)

## App Installer (Python)

Entry point: `install_apps/install.py`

Modes and selection logic:

- `auto`: chooses `brew` if sudo is available, otherwise `miniforge`
- `brew`: uses Homebrew if present; installs it if missing
- `miniforge`: installs Miniforge + Mamba if missing, then uses an environment named `apps`

Arguments:

- `--mode {auto,brew,miniforge}`: default `auto`
- `--app-list {minimal,optional,full}`: required; `full` installs all lists
- `--force-reinstall`: reinstall even if command already exists in PATH
- `--custom-bin-path <path>`: custom Mamba binary path when using `miniforge`

Examples:

```bash
# Auto mode + minimal set
python3 install_apps/install.py --mode auto --app-list minimal

# Install everything from all list files
python3 install_apps/install.py --mode auto --app-list full

# Force reinstall optional set via miniforge
python3 install_apps/install.py --mode miniforge --app-list optional --force-reinstall

# Use custom Mamba path with miniforge mode
python3 install_apps/install.py --mode miniforge --app-list minimal --custom-bin-path /custom/mamba
```

How it works:

1. Ensures Git is available (`utils/check_git.py` supports Debian/Fedora/Arch/Alpine/SUSE)
2. Detects environment (`core/context.py`) to decide package manager
3. Loads apps from `app_lists/*.txt` (ignores blank lines and comments)
4. Skips already installed apps unless `--force-reinstall` is used
5. Package managers:
	 - Homebrew: `brew install`
	 - Miniforge (Mamba): installs Miniforge if missing, creates `apps` env, installs there, and tries to symlink binaries into `~/.local/bin`

Notes:

- Ensure `~/.local/bin` exists and is on your PATH if you rely on the symlinked binaries from the Mamba env.

## Update & Maintain

1. Edit or add config files in the appropriate directory
2. Run `./install_dotfiles.sh --dry-run` to review changes
3. Apply with `./install_dotfiles.sh`
4. To add apps, append names to the desired `*.txt` list and rerun the installer

## Safety & Rollback

- All replaced items are backed up under `~/.dotfiles_backup/<timestamp>`
- `backup-list.txt` summarizes what moved or was dereferenced
- To restore, copy files back from the backup directory

## Troubleshooting

| Issue | Fix |
|------|-----|
| Too many backups | Remove old directories under `~/.dotfiles_backup` |
| Git not auto-installed | Install via your distro’s package manager, then rerun the app installer |
| Symlinks not effective | Reload your shell: `source ~/.bashrc` |
| Miniforge install fails | Check network and rerun; verify `mamba` binary path if using `--custom-bin-path` |

## Roadmap

- add `Neovim`-focused configuration
