session_root "$HOME/dotfiles"

if initialize_session "dotfiles"; then
  new_window "edit-dotfiles"
  new_window "lazygit-dotfiles"
  run_cmd "lazygit"

  select_window "edit-dotfiles"
  run_cmd "$EDITOR ."
fi

# Finalize session creation and switch/attach to it.
finalize_and_go_to_session
