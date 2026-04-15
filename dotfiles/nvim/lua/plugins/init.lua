-- lua/plugins/init.lua

-- #TODO: add specs in the first place since plugins should be added to runtime path immediately.

require("plugins.which-key")
require("plugins.snacks")

require("plugins.ai")

require("plugins.catppuccin")
require("plugins.noice")
require("plugins.flash")
require("plugins.bufferline")
require("plugins.lualine")
require("plugins.gitsigns")
require("plugins.blink")
require("plugins.vim-tmux-navigator")
require("plugins.mini")
require("plugins.rainbow-delimiters")
require("plugins.indent-blankline")
require("plugins.trouble")
require("plugins.grug-far")

require("plugins.lang")

local function get_plugin_names(arg_lead)
  local installed = vim.pack.get(nil, { info = false })
  local names = {}
  for _, p in ipairs(installed) do
    local name = p.spec.name
    if name:lower():find(arg_lead:lower(), 1, true) == 1 then
      table.insert(names, name)
    end
  end
  table.sort(names)
  return names
end

vim.api.nvim_create_user_command("PackUpdate", function(opts)
  local targets = #opts.fargs > 0 and opts.fargs or nil
  if targets then
    vim.notify("Checking updates for: " .. table.concat(targets, ", "), vim.log.levels.INFO)
  else
    vim.notify("Checking updates for all plugins...", vim.log.levels.INFO)
  end
  vim.pack.update(targets)
end, {
  nargs = "*",
  complete = get_plugin_names,
  desc = "Update specified or all plugins",
})

vim.api.nvim_create_user_command("PackStatus", function(opts)
  local targets = #opts.fargs > 0 and opts.fargs or nil
  vim.pack.update(targets, { offline = true })
end, {
  nargs = "*",
  complete = get_plugin_names,
  desc = "Check plugin status without downloading",
})
