#!/usr/bin/env bash
set -euo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_TEMPLATE="$SCRIPT_DIR/agent/settings.template.json"
TEMPLATE_PATH="${PI_SETTINGS_TEMPLATE_PATH:-$DEFAULT_TEMPLATE}"
SETTINGS_PATH="$AGENT_DIR/settings.json"

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "[pi-settings] Template not found: $TEMPLATE_PATH" >&2
  echo "[pi-settings] Set PI_SETTINGS_TEMPLATE_PATH to override template location." >&2
  exit 1
fi

mkdir -p "$AGENT_DIR"
cp "$TEMPLATE_PATH" "$SETTINGS_PATH"

echo "[pi-settings] Applied template: $TEMPLATE_PATH"
echo "[pi-settings] Wrote settings:   $SETTINGS_PATH"
