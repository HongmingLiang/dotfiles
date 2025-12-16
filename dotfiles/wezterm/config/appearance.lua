-- Appearance settings for WezTerm
local wezterm = require 'wezterm'
local platform = require("utils.platform")

config = {
    -- font
    font = wezterm.font_with_fallback {
        'JetBrainsMono Nerd Font',
        -- 'LXGW WenKai Mono',
        'Consolas',
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
    window_frame = {
        active_titlebar_bg = "#090909",
        inactive_titlebar_bg = "#090909"
    },
    window_close_confirmation = 'NeverPrompt',
    window_decorations = "INTEGRATED_BUTTONS | TITLE | RESIZE",
    adjust_window_size_when_changing_font_size = false,

    -- tabs
    enable_tab_bar = true,
    use_fancy_tab_bar = true,
    show_tab_index_in_tab_bar = true,
    hide_tab_bar_if_only_one_tab = true,
    switch_to_last_active_tab_when_closing_tab = true,
    tab_max_width = 25,
    
   -- scrollbar
   enable_scroll_bar = true,
}

if platform.is_win then
    -- https://wezterm.org/config/lua/config/win32_system_backdrop.html
    -- config.win32_system_backdrop = "Acrylic"
    config.window_background_opacity = 0.9
    config.text_background_opacity = 0.9
elseif platform.is_mac then
    -- https://wezterm.org/config/lua/config/macos_window_background_blur.html
    config.macos_window_background_blur = 20
    config.window_background_opacity = 0.95
    config.text_background_opacity = 0.9
elseif platform.is_linux then
    -- https://wezterm.org/config/lua/config/kde_window_background_blur.html
    config.window_background_opacity = 0.9
    config.text_background_opacity = 0.9
    config.kde_window_background_blur = true
end

return config