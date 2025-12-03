local Config = require('config')

require('events.toggle-tab-bar').setup()
require('events.gui-startup').setup()

return Config:init()
    -- :append(require('wezterm').config_builder())
    :append(require('config.performance'))
    :append(require('config.appearance'))
    :append(require('config.keybindings'))
    :append(require('config.launch'))
    :append(require('config.general'))
    .options
