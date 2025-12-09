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
      -- transparent
      transparent_background = true,
      float = {
        transparent = true,
      },
      -- override colors
      custom_highlights = function(colors)
        return {
          LineNr = { fg = colors.overlay1 },
        }
      end,
      -- integrations
      integrations = {
        rainbow_delimiters = true,
      },
      auto_integrations = true,
    },
  },
  {
    "MeanderingProgrammer/render-markdown.nvim",
    opts = {
      code = { border = "thick" },
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
