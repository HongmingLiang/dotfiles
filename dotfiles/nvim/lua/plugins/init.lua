-- lua/plugins/init.lua

local spec = {
  { src = "https://github.com/folke/which-key.nvim.git" },
  { src = "https://github.com/folke/snacks.nvim.git" },
  { src = "https://github.com/nvim-mini/mini.nvim.git" },
  { src = "https://github.com/catppuccin/nvim.git", name = "catppuccin" },
  { src = "https://github.com/folke/flash.nvim.git" },
  { src = "https://github.com/folke/noice.nvim.git" },
  { src = "https://github.com/MunifTanjim/nui.nvim.git" }, -- dependency for noice.nvim
  { src = "https://github.com/akinsho/bufferline.nvim.git" },
  { src = "https://github.com/nvim-lualine/lualine.nvim" },
  { src = "https://github.com/lewis6991/gitsigns.nvim.git" },
  {
    src = "https://github.com/saghen/blink.cmp",
    version = vim.version.range("1.*"),
  },
  { src = "https://github.com/christoomey/vim-tmux-navigator.git" },
  { src = "https://github.com/HiPhish/rainbow-delimiters.nvim.git" },
  { src = "https://github.com/lukas-reineke/indent-blankline.nvim.git" },
  { src = "https://github.com/folke/trouble.nvim.git" },
  { src = "https://github.com/MagicDuck/grug-far.nvim.git" },

  -- lang
  { src = "https://github.com/neovim/nvim-lspconfig.git" },
  {
    src = "https://github.com/mason-org/mason.nvim.git",
    build = ":MasonUpdate",
  },
  { src = "https://github.com/mason-org/mason-lspconfig.nvim.git" },
  { src = "https://github.com/mfussenegger/nvim-lint.git" },
  { src = "https://github.com/stevearc/conform.nvim.git" },
  {
    src = "https://github.com/nvim-treesitter/nvim-treesitter.git",
    branch = "main",
    build = ":TSUpdate",
  },
  --- python
  { src = "https://github.com/linux-cultist/venv-selector.nvim.git" },

  -- AI
  {
    src = "https://github.com/zbirenbaum/copilot.lua.git",
    build = ":Copilot auth",
  },
  { src = "https://github.com/fang2hou/blink-copilot.git" }, -- provider for blink.cmp
  { src = "https://github.com/nickjvandyke/opencode.nvim.git" },
}

local disabled_spec = {
  -- Use src to disable plugins from spec above.
  "https://github.com/nickjvandyke/opencode.nvim.git",
}

if #disabled_spec > 0 then
  spec = vim.tbl_filter(function(plugin)
    return not vim.tbl_contains(disabled_spec, plugin.src)
  end, spec)
end

vim.pack.add(spec)

require("plugins.which-key")
require("plugins.snacks")
require("plugins.mini")
require("plugins.catppuccin")
require("plugins.noice")
require("plugins.flash")
require("plugins.bufferline")
require("plugins.lualine")
require("plugins.gitsigns")
require("plugins.blink")
require("plugins.vim-tmux-navigator")
require("plugins.rainbow-delimiters")
require("plugins.indent-blankline")
require("plugins.trouble")
require("plugins.grug-far")

require("plugins.lang")
require("plugins.ai")

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
