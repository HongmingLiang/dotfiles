-- pick from https://zhuanlan.zhihu.com/p/1973514411802108537
local wezterm = require('wezterm')

local M = {}
function M.setup()
    wezterm.on('toggle-tab-bar', function(window, pane)
        local overrides = window:get_config_overrides() or {}
        if overrides.enable_tab_bar == nil then
            overrides.enable_tab_bar = false
        else
            overrides.enable_tab_bar = not overrides.enable_tab_bar
        end
        window:set_config_overrides(overrides)
    end)
end

return M