# Git Installation Checker

This module provides functionality to check if Git is installed and automatically install it if needed, with support for multiple Linux distributions.

## Features

- **Automatic Distribution Detection**: Detects the Linux distribution automatically
- **Multi-Distribution Support**: Supports the following distributions:
  - Debian-based (Ubuntu, Debian, Linux Mint, etc.) - uses `apt-get`
  - Fedora/RHEL-based (Fedora, CentOS, Rocky Linux, AlmaLinux) - uses `dnf` or `yum`
  - Arch-based (Arch Linux, Manjaro) - uses `pacman`
  - Alpine Linux - uses `apk`
  - SUSE-based (openSUSE, SUSE) - uses `zypper`
- **Safe Operation**: Checks if Git is already installed before attempting installation
- **Flexible Usage**: Can be used as a Python module, standalone Python script, or shell script

## Usage

### As a Shell Script

The easiest way to use the Git checker:

```bash
./check_git.sh
```

### As a Python Script

```bash
python3 check_git.py
```

### As a Python Module

Import and use in your Python code:

```python
from check_git import ensure_git_installed

# Check and install git if needed
if ensure_git_installed():
    print("Git is ready!")
else:
    print("Failed to install Git")
```

### Individual Functions

```python
from check_git import (
    is_git_installed,
    detect_distro,
    install_git,
    command_exists
)

# Check if git is installed
if is_git_installed():
    print("Git is installed")

# Detect the Linux distribution
distro = detect_distro()
print(f"Detected distribution: {distro}")

# Install git (will detect distribution automatically)
success = install_git()
```

## Integration with install.py

The Git checker is automatically integrated into the `install.py` script. When you run the application installer, it will:

1. Check if Git is installed
2. If not installed, attempt to install it based on your distribution
3. Proceed with the application installation only if Git is available

Example:

```bash
python3 install.py -a minimal
```

This will check for Git before installing any applications.

## Supported Package Managers

| Distribution | Package Manager | Command Used |
|-------------|----------------|--------------|
| Debian/Ubuntu | apt-get | `sudo apt-get install -y git` |
| Fedora/RHEL | dnf/yum | `sudo dnf install -y git` |
| Arch Linux | pacman | `sudo pacman -Sy --noconfirm git` |
| Alpine Linux | apk | `sudo apk add git` |
| openSUSE/SUSE | zypper | `sudo zypper install -y git` |

## Requirements

- Python 3.6 or higher
- `sudo` privileges (for installation)
- Internet connection (for downloading Git package)

## Error Handling

The script includes comprehensive error handling:

- Checks for sudo privileges before attempting installation
- Validates commands and package managers existence
- Provides clear error messages if installation fails
- Falls back to manual installation instructions for unsupported distributions

## Exit Codes

When used as a standalone script:
- `0`: Git is installed and ready
- `1`: Git installation failed or not available

## Notes

- The script requires sudo privileges to install Git
- Installation will update package manager cache/index when needed
- If your distribution is not automatically detected, you'll be prompted to install Git manually
