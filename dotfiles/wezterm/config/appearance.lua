-- Appearance settings for WezTerm
local wezterm = require 'wezterm'

return {
    -- font
    font = wezterm.font_with_fallback {
        'JetBrainsMono Nerd Font',
        -- 'LXGW WenKai Mono',
        'Consolas',
        'Symbol Nerd Font Mono',
    },
    -- font = wezterm.font('JetBrainsMono Nerd Font', {weight = 'Medium'}),
    font_size = 12,
    
    -- colors
    color_scheme = 'tokyonight',

    -- cursor
    default_cursor_style = 'SteadyBar',

    -- window
    initial_rows = 40,
    initial_cols = 100,
    window_close_confirmation = 'NeverPrompt',
    window_decorations = "INTEGRATED_BUTTONS | TITLE | RESIZE",
    enable_tab_bar = true,
    window_background_opacity = 0.9,
    -- kde_window_background_blur = true,
    use_fancy_tab_bar = true,
    adjust_window_size_when_changing_font_size = false,
    window_frame = {
        active_titlebar_bg = "#090909",
        inactive_titlebar_bg = "#090909"
    },

    -- tabs
    show_tab_index_in_tab_bar = true,
    hide_tab_bar_if_only_one_tab = true,
    switch_to_last_active_tab_when_closing_tab = true,
    tab_max_width = 25,
    
   -- scrollbar
   enable_scroll_bar = true,
}
