-- lua/plugins/lang/markdown.lua

require("render-markdown").setup({
  heading = { width = "block", min_width = 80 },
  code = { width = "block", min_width = 80, border = "thick" },
  quote = { repeat_linebreak = true },
  pipe_table = { preset = "round" },
  completions = { lsp = { enabled = true } },
  link = {
    custom = {
      python = { pattern = "%.py$", icon = "󰌠 " },
    },
  },
})
