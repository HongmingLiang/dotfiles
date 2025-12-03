-- Colorscheme configurations

return {
  {
    "LazyVim/LazyVim",
    opts = { colorscheme = "catppuccin" },
  },
  {
    "catppuccin/nvim",
    opts = {
      flavour = "mocha",
      background = { light = "latte", dark = "mocha" },
      transparent_background = true,
      float = {
        transparent = true,
      },
      integrations = {
        rainbow_delimiters = true,
      },
      auto_integrations = true,
    },
  },
  {
    "folke/tokyonight.nvim",
    enable = false,
    opts = {
      on_colors = function(colors)
        colors.comment = "#9aa5ce"
      end,
    },
  },
}
