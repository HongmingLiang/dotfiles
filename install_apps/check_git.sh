#!/bin/bash
# 
# Git Installation Checker and Installer
# 
# This script checks if git is installed and installs it if necessary.
# It supports multiple Linux distributions (Debian, Fedora, Arch, Alpine, SUSE).
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "Git Installation Checker"
echo "============================================================"

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is required but not found."
    echo "[INFO] Please install Python 3 first."
    exit 1
fi

# Run the Python script
python3 "$SCRIPT_DIR/check_git.py"
