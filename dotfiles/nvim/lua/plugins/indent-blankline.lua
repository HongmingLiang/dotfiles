vim.pack.add({ "https://github.com/lukas-reineke/indent-blankline.nvim.git" })

local initialized = false
local state = false

local function setup()
  if initialized then return end
  local highlight = {
    "RainbowRed",
    "RainbowYellow",
    "RainbowBlue",
    "RainbowOrange",
    "RainbowGreen",
    "RainbowViolet",
    "RainbowCyan",
  }
  vim.g.rainbow_delimiters = { highlight = highlight }
  local hooks = require("ibl.hooks")
  -- create the highlight groups in the highlight setup hook, so they are reset
  -- every time the colorscheme changes
  hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
    vim.api.nvim_set_hl(0, "RainbowRed", { fg = "#E06C75" })
    vim.api.nvim_set_hl(0, "RainbowYellow", { fg = "#E5C07B" })
    vim.api.nvim_set_hl(0, "RainbowBlue", { fg = "#61AFEF" })
    vim.api.nvim_set_hl(0, "RainbowOrange", { fg = "#D19A66" })
    vim.api.nvim_set_hl(0, "RainbowGreen", { fg = "#98C379" })
    vim.api.nvim_set_hl(0, "RainbowViolet", { fg = "#C678DD" })
    vim.api.nvim_set_hl(0, "RainbowCyan", { fg = "#56B6C2" })
  end)

  require("ibl").setup({ enabled = state, indent = { highlight = highlight }, scope = { highlight = highlight }})

  hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)

  initialized = true
end

vim.keymap.set("n", "<leader>ui", function()
  setup()
  vim.cmd("IBLToggle")
  local has_snack, _ = pcall(require, "snacks.indent")
  if not has_snack then return end
  state = not state
  if state then
    Snacks.indent.disable()
  else
    Snacks.indent.enable()
  end
end, { desc = "Toggle indent-blankline" })
