vim.pack.add({
  { src = "https://github.com/zbirenbaum/copilot.lua.git", build = ":Copilot auth" },
  "https://github.com/fang2hou/blink-copilot.git",
})

vim.api.nvim_create_autocmd("InsertEnter", {
  once = true,
  callback = function()
    require("copilot").setup({
      suggestion = { enabled = false },
      panel = { enabled = false },
      filetypes = {
        markdown = true,
        help = true,
      },
    })
  end,
})
