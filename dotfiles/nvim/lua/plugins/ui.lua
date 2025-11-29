-- UI related plugins

return {
  {
    "folke/tokyonight.nvim",
    opts = {
      on_colors = function(colors)
        colors.comment = "#9aa5ce"
      end,
    },
  },
}
