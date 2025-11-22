#!/usr/bin/env python3
"""
Git installation checker and installer with multi-distribution support.

This module checks if git is installed and installs it if necessary,
with support for multiple Linux distributions.
"""

from subprocess import run, CalledProcessError
from shutil import which
from pathlib import Path


def command_exists(command: str) -> bool:
    """Check if a command exists in the system PATH."""
    return which(command) is not None


def detect_distro() -> str:
    """
    Detect the Linux distribution.
    
    Returns:
        str: Distribution identifier ('debian', 'fedora', 'arch', 'alpine', 'unknown')
    """
    # Check for os-release file (standard on most modern Linux systems)
    os_release_paths = [Path('/etc/os-release'), Path('/usr/lib/os-release')]
    
    for os_release_path in os_release_paths:
        if os_release_path.exists():
            try:
                content = os_release_path.read_text()
                content_lower = content.lower()
                
                # Check for specific distributions
                if 'debian' in content_lower or 'ubuntu' in content_lower or 'mint' in content_lower:
                    return 'debian'
                elif 'fedora' in content_lower or 'rhel' in content_lower or 'centos' in content_lower or 'rocky' in content_lower or 'alma' in content_lower:
                    return 'fedora'
                elif 'arch' in content_lower or 'manjaro' in content_lower:
                    return 'arch'
                elif 'alpine' in content_lower:
                    return 'alpine'
                elif 'opensuse' in content_lower or 'suse' in content_lower:
                    return 'suse'
            except Exception as e:
                print(f"[WARNING] Could not read {os_release_path}: {e}")
    
    # Fallback: check for package managers
    if command_exists('apt-get'):
        return 'debian'
    elif command_exists('dnf') or command_exists('yum'):
        return 'fedora'
    elif command_exists('pacman'):
        return 'arch'
    elif command_exists('apk'):
        return 'alpine'
    elif command_exists('zypper'):
        return 'suse'
    
    return 'unknown'


def is_git_installed() -> bool:
    """
    Check if git is installed.
    
    Returns:
        bool: True if git is installed, False otherwise
    """
    return command_exists('git')


def install_git_debian() -> bool:
    """
    Install git on Debian-based distributions (Ubuntu, Debian, Mint, etc.).
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    print("[INFO] Installing git on Debian-based system...")
    try:
        # Update package list
        run(['sudo', 'apt-get', 'update', '-y'], check=True)
        # Install git
        run(['sudo', 'apt-get', 'install', '-y', 'git'], check=True)
        print("[SUCCESS] Git installed successfully via apt-get.")
        return True
    except CalledProcessError as e:
        print(f"[ERROR] Failed to install git via apt-get: {e}")
        return False


def install_git_fedora() -> bool:
    """
    Install git on Fedora-based distributions (Fedora, RHEL, CentOS, Rocky, AlmaLinux).
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    print("[INFO] Installing git on Fedora/RHEL-based system...")
    
    # Try dnf first (newer), then fall back to yum
    if command_exists('dnf'):
        cmd = ['sudo', 'dnf', 'install', '-y', 'git']
        pkg_manager = 'dnf'
    elif command_exists('yum'):
        cmd = ['sudo', 'yum', 'install', '-y', 'git']
        pkg_manager = 'yum'
    else:
        print("[ERROR] Neither dnf nor yum found on the system.")
        return False
    
    try:
        run(cmd, check=True)
        print(f"[SUCCESS] Git installed successfully via {pkg_manager}.")
        return True
    except CalledProcessError as e:
        print(f"[ERROR] Failed to install git via {pkg_manager}: {e}")
        return False


def install_git_arch() -> bool:
    """
    Install git on Arch-based distributions (Arch Linux, Manjaro).
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    print("[INFO] Installing git on Arch-based system...")
    try:
        run(['sudo', 'pacman', '-Sy', '--noconfirm', 'git'], check=True)
        print("[SUCCESS] Git installed successfully via pacman.")
        return True
    except CalledProcessError as e:
        print(f"[ERROR] Failed to install git via pacman: {e}")
        return False


def install_git_alpine() -> bool:
    """
    Install git on Alpine Linux.
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    print("[INFO] Installing git on Alpine Linux...")
    try:
        run(['sudo', 'apk', 'add', 'git'], check=True)
        print("[SUCCESS] Git installed successfully via apk.")
        return True
    except CalledProcessError as e:
        print(f"[ERROR] Failed to install git via apk: {e}")
        return False


def install_git_suse() -> bool:
    """
    Install git on openSUSE/SUSE-based distributions.
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    print("[INFO] Installing git on SUSE-based system...")
    try:
        run(['sudo', 'zypper', 'install', '-y', 'git'], check=True)
        print("[SUCCESS] Git installed successfully via zypper.")
        return True
    except CalledProcessError as e:
        print(f"[ERROR] Failed to install git via zypper: {e}")
        return False


def install_git() -> bool:
    """
    Install git based on the detected distribution.
    
    Returns:
        bool: True if installation was successful, False otherwise
    """
    distro = detect_distro()
    print(f"[INFO] Detected distribution: {distro}")
    
    if distro == 'debian':
        return install_git_debian()
    elif distro == 'fedora':
        return install_git_fedora()
    elif distro == 'arch':
        return install_git_arch()
    elif distro == 'alpine':
        return install_git_alpine()
    elif distro == 'suse':
        return install_git_suse()
    else:
        print(f"[ERROR] Unsupported or unknown distribution: {distro}")
        print("[INFO] Please install git manually for your distribution.")
        return False


def ensure_git_installed() -> bool:
    """
    Ensure git is installed on the system. Install if not present.
    
    Returns:
        bool: True if git is installed (or installation was successful), False otherwise
    """
    if is_git_installed():
        print("[INFO] Git is already installed.")
        git_version = run(['git', '--version'], capture_output=True, text=True)
        print(f"[INFO] {git_version.stdout.strip()}")
        return True
    
    print("[WARNING] Git is not installed. Attempting to install...")
    success = install_git()
    
    if success and is_git_installed():
        git_version = run(['git', '--version'], capture_output=True, text=True)
        print(f"[INFO] {git_version.stdout.strip()}")
        return True
    else:
        print("[ERROR] Git installation failed or git is still not available.")
        return False


def main() -> None:
    """Main entry point for the script."""
    print("=" * 60)
    print("Git Installation Checker")
    print("=" * 60)
    
    success = ensure_git_installed()
    
    if success:
        print("\n[SUCCESS] Git is ready to use!")
        exit(0)
    else:
        print("\n[ERROR] Git is not available. Please install it manually.")
        exit(1)


if __name__ == "__main__":
    main()
