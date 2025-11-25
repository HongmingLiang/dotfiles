-- Appearance settings for WezTerm
local wezterm = require 'wezterm'

return {
    -- font
    font = wezterm.font('JetBrainsMono Nerd Font', {weight = 'Medium'}),
    font_size = 12,
    
    -- colors
    color_scheme = 'tokyonight',

    -- cursor
    default_cursor_style = 'SteadyBar',

    -- window
    initial_rows = 40,
    initial_cols = 100,
    enable_scroll_bar = true,
    window_close_confirmation = 'NeverPrompt',
    window_decorations = "INTEGRATED_BUTTONS | TITLE | RESIZE",
    enable_tab_bar = true,
    window_background_opacity = 0.9,
    use_fancy_tab_bar = true,

    -- tabs
    show_tab_index_in_tab_bar = true,
    hide_tab_bar_if_only_one_tab = true,
    switch_to_last_active_tab_when_closing_tab = true,
    tab_max_width = 25,
    
   -- scrollbar
   enable_scroll_bar = true,
}
