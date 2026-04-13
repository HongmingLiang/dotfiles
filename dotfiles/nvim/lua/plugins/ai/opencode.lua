vim.pack.add({ "https://github.com/nickjvandyke/opencode.nvim.git" })

vim.keymap.set({ "n", "x" }, "<leader>aa", function()
  require("opencode").ask("@this: ", { submit = true })
end, { desc = "Ask opencode…" })
vim.keymap.set({ "n", "x" }, "<leader>as", function()
  require("opencode").select()
end, { desc = "Execute opencode action…" })

vim.keymap.set({ "x" }, "go", function()
  return require("opencode").operator("@this ")
end, { desc = "Add range to opencode", expr = true })
vim.keymap.set("n", "go", function()
  return require("opencode").operator("@this ") .. "_"
end, { desc = "Add line to opencode", expr = true })
