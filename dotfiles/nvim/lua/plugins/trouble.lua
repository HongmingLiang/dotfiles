-- trouble.nvim

local initialized = false
local function setup()
  if initialized then return end
  require("trouble").setup({
    modes = {
      lsp = {
        win = { position = "right" },
      },
    },
  })
  initialized = true
end

local function map(lhs, rhs, desc)
  vim.keymap.set("n", lhs, rhs, { desc = desc })
end

map("<leader>cs", function()
  setup()
  vim.cmd("Trouble symbols toggle")
end, "Toggle symbol (Trouble)")

map("<leader>cS", function()
  setup()
  vim.cmd("Trouble lsp toggle")
end, "Toggle LSP references/definitions/... (Trouble)")

map("<leader>xx", function()
  setup()
  vim.cmd("Trouble diagnostics toggle filter.buf=0")
end, "Buffer Diagnostics (Trouble)")

map("<leader>xX", function()
  setup()
  vim.cmd("Trouble diagnostics toggle")
end, "Diagnostics (Trouble)")
