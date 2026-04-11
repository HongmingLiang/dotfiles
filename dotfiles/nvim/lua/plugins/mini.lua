vim.pack.add({ "https://github.com/nvim-mini/mini.nvim.git" })

require("mini.ai").setup({})

require("mini.pairs").setup({
  modes = { insert = true, command = true, terminal = false },
  -- skip autopair when next character is one of these
  skip_next = [=[[%w%%%'%[%"%.%`%$]]=],
  -- skip autopair when the cursor is inside these treesitter nodes
  skip_ts = { "string" },
})

require("mini.icons").setup({})

require("mini.surround").setup({
  mappings = {
    add = "",
  },
})
