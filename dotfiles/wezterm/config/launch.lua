-- launch settings for WezTerm
local platform = require('utils.platform')

local launch_config = {
    default_prog = {},
    launch_menu = {},
}

if platform.is_win then
    launch_config.default_prog = { 'powershell', '-NoLogo' }
    launch_config.launch_menu = {
        { label = 'PowerShell', args = { 'powershell', '-NoLogo' }, },
        { label = 'Ubuntu (WSL)', args = { 'wsl', '-d', 'Ubuntu' }, },
        { label = 'cmd', args = { 'cmd.exe' }, },
    }
end

return launch_config
