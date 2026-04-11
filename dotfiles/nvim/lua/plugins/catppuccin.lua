vim.pack.add({
  { src = "https://github.com/catppuccin/nvim.git", name = "catppuccin" },
}, { load = true })

require("catppuccin").setup({
  flavour = "mocha", -- latte, frappe, macchiato, mocha
  -- transparent_background = true,
  float = {
    transparent = true,
    -- solid = true,
  },
})

vim.cmd.colorscheme("catppuccin-mocha")
