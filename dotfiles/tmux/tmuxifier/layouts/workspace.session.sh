# Set a custom session root path. Default is `$HOME`.
# Must be called before `initialize_session`.
session_root "$(pwd)"

# Create session with specified name if it does not already exist. If no
# argument is given, session name will be based on layout file name.
if initialize_session "workspace"; then

  new_window "$EDITOR"

  new_window "agent"

  new_window "lazygit"
  run_cmd "lazygit"

  new_window "cli"
  [[ -d ".venv" ]] && run_cmd "source .venv/bin/activate"

  select_window "$EDITOR"
  [[ -d ".venv" ]] && run_cmd "source .venv/bin/activate"
  run_cmd "$EDITOR"
fi

# Finalize session creation and switch/attach to it.
finalize_and_go_to_session
