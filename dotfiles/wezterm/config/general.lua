-- General settings for WezTerm
return {
    check_for_updates = false,
    audible_bell = 'Disabled',
    cache_dir = require('wezterm').home_dir .. '/.cache/wezterm',
    enable_mux = false,

    -- keep config updated automatically while reconfiguring, remember to comment this out when configuration is done
    automatically_reload_config = true
}
