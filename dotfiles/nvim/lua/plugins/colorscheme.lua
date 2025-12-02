-- Colorscheme configurations

return {
  {
    "LazyVim/LazyVim",
    opts = { colorscheme = "catppuccin" },
  },
  {
    "catppuccin/nvim",
    opts = {
      background = { light = "latte", dark = "mocha" },
      transparent_background = true,
    },
  },
  {
    "folke/tokyonight.nvim",
    opts = {
      on_colors = function(colors)
        colors.comment = "#9aa5ce"
      end,
    },
  },
}
