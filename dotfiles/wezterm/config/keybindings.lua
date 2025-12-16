-- ref: https://github.com/KevinSilvester/wezterm-config/blob/master/config/bindings.lua
local wezterm = require("wezterm")
local platform = require("utils.platform")
local act = wezterm.action

local MOD = {}
if platform.is_mac then
	MOD.SUPER = "SUPER"
	MOD.SUPER_REV = "SUPER|CTRL"
elseif platform.is_win or platform.is_linux then
	MOD.SUPER = "ALT"
	MOD.SUPER_REV = "ALT|CTRL"
end

local leader = { key = "w", mods = MOD.SUPER, timeout_milliseconds = 1500 }
local keys = {
	-- useful actions --
	{ key = "/", mods = "LEADER", action = act.Search({ CaseInSensitiveString = "" }) },

	{
		key = "u",
		mods = MOD.SUPER_REV,
		action = wezterm.action.QuickSelectArgs({
			label = "open url",
			patterns = {
				"\\((https?://\\S+)\\)",
				"\\[(https?://\\S+)\\]",
				"\\{(https?://\\S+)\\}",
				"<(https?://\\S+)>",
				"\\bhttps?://\\S+[)/a-zA-Z0-9-]+",
			},
			action = wezterm.action_callback(function(window, pane)
				local url = window:get_selection_text_for_pane(pane)
				wezterm.log_info("opening: " .. url)
				wezterm.open_with(url)
			end),
		}),
	},
	{ key = "p", mods = MOD.SUPER, action = act.ActivateCommandPalette },
	{ key = "F2", mods = "NONE", action = "ActivateCopyMode" },
	{ key = "F3", mods = "NONE", action = act.ShowLauncher },
	{ key = "F12", mods = "NONE", action = act.ShowDebugOverlay },

	-- copy/paste --
	{ key = "c", mods = "CTRL|SHIFT", action = act.CopyTo("Clipboard") },
	{ key = "v", mods = "CTRL|SHIFT", action = act.PasteFrom("Clipboard") },
	-- tabs --
	{ key = "t", mods = MOD.SUPER, action = act.SpawnTab("CurrentPaneDomain") },
	{ key = "e", mods = "LEADER", action = act.CloseCurrentTab({ confirm = false }) },
	{ key = "[", mods = MOD.SUPER, action = act.ActivateTabRelative(-1) },
	{ key = "]", mods = MOD.SUPER, action = act.ActivateTabRelative(1) },
	{ key = "1", mods = MOD.SUPER, action = act.ActivateTab(0) },
	{ key = "2", mods = MOD.SUPER, action = act.ActivateTab(1) },
	{ key = "3", mods = MOD.SUPER, action = act.ActivateTab(2) },
	{ key = "4", mods = MOD.SUPER, action = act.ActivateTab(3) },
	{ key = "5", mods = MOD.SUPER, action = act.ActivateTab(4) },
	{ key = "6", mods = MOD.SUPER, action = act.ActivateTab(5) },
	{ key = "7", mods = MOD.SUPER, action = act.ActivateTab(6) },
	{ key = "8", mods = MOD.SUPER, action = act.ActivateTab(7) },
	{ key = "9", mods = MOD.SUPER, action = act.ActivateTab(8) },

	-- cursor movement --
	{ key = "LeftArrow", mods = MOD.SUPER, action = act.SendString("\u{1b}OH") },
	{ key = "RightArrow", mods = MOD.SUPER, action = act.SendString("\u{1b}OF") },
	{ key = "Backspace", mods = MOD.SUPER, action = act.SendString("\u{15}") },

	-- window --
	{ key = "n", mods = "LEADER", action = act.SpawnWindow },
	{ key = "F11", mods = "NONE", action = act.ToggleFullScreen },

	-- panes --
	-- panes: split panes
	{
		key = [[\]],
		mods = "LEADER",
		action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "-",
		mods = "LEADER",
		action = act.SplitVertical({ domain = "CurrentPaneDomain" }),
	},

	-- panes: zoom+close pane
	{ key = "Enter", mods = MOD.SUPER, action = act.TogglePaneZoomState },
	{ key = "e", mods = "LEADER", action = act.CloseCurrentPane({ confirm = false }) },

	-- panes: navigation
	{ key = "k", mods = MOD.SUPER_REV, action = act.ActivatePaneDirection("Up") },
	{ key = "j", mods = MOD.SUPER_REV, action = act.ActivatePaneDirection("Down") },
	{ key = "h", mods = MOD.SUPER_REV, action = act.ActivatePaneDirection("Left") },
	{ key = "l", mods = MOD.SUPER_REV, action = act.ActivatePaneDirection("Right") },
	{
		key = "p",
		mods = MOD.SUPER_REV,
		action = act.PaneSelect({ alphabet = "1234567890", mode = "SwapWithActiveKeepFocus" }),
	},

	-- panes: scroll pane
	{ key = "u", mods = MOD.SUPER, action = act.ScrollByLine(-5) },
	{ key = "d", mods = MOD.SUPER, action = act.ScrollByLine(5) },
	{ key = "PageUp", mods = "NONE", action = act.ScrollByPage(-0.75) },
	{ key = "PageDown", mods = "NONE", action = act.ScrollByPage(0.75) },

	-- toggle tab bar
	{ key = "t", mods = "LEADER", action = wezterm.action.EmitEvent("toggle-tab-bar") },
}

local mouse = {
	{ -- left click to copy selection to clipboard
		event = { Up = { streak = 1, button = "Left" } },
		mods = "NONE",
		action = wezterm.action.CompleteSelection("Clipboard"),
	},
	{ -- right click to paste from clipboard
		event = { Down = { streak = 1, button = "Right" } },
		mods = "NONE",
		action = wezterm.action.PasteFrom("Clipboard"),
	},
	{ -- Ctrl+Alt drag to move window
		event = { Drag = { streak = 1, button = "Left" } },
		mods = MOD.SUPER_REV,
		action = wezterm.action.StartWindowDrag,
	},
	{ -- Ctrl open link at mouse cursor
		event = { Up = { streak = 1, button = "Left" } },
		mods = "CTRL",
		action = wezterm.action.OpenLinkAtMouseCursor,
	},
}

return {
	leader = leader,
	keys = keys,
	mouse_bindings = mouse,
	warn_about_missing_glyphs = false,
}
