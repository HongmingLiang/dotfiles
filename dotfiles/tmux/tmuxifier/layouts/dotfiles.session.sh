session_root "$HOME/dotfiles"

if initialize_session "dotfiles"; then
  new_window "$EDITOR"
  new_window "lazygit"
  run_cmd "lazygit"

  select_window "$EDITOR"
  run_cmd "$EDITOR ."
fi

# Finalize session creation and switch/attach to it.
finalize_and_go_to_session
