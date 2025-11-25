local Config = require('config')

return Config:init()
    -- :append(require('wezterm').config_builder())
    :append(require('config.appearance'))
    :append(require('config.keybindings'))
    :append(require('config.launch'))
    :append(require('config.performance'))
    .options
