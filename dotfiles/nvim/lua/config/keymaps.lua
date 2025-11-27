-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

----- My custom configuration -----
local map = vim.keymap.set
local unmap = vim.keymap.del

-- override <C-_> from "open Terminal" to "Toggle Comment"
-- and map <C-t> to open floating Terminal
unmap({ "n", "t" }, "<c-_>", { desc = "which_key_ignore" })
map("v", "<C-_>", "gc", { desc = "Toggle Comment", remap = true })
map("n", "<C-_>", "gcc", { desc = "Toggle Comment", remap = true })
map({ "n", "t" }, "<C-t>", function()
  Snacks.terminal(nil, { cwd = LazyVim.root() })
end, { desc = "Terminal (Root Dir)" })

-- fast escape to normal mode
map("i", "jk", "<Esc>l", { desc = "Escape to normal mode" })

-- set alt to move to window
map("n", "<A-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
map("n", "<A-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
map("n", "<A-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
map("n", "<A-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })

-- override line moving
unmap("n", "<A-j>", { desc = "Move Down" })
unmap("n", "<A-k>", { desc = "Move Up" })
unmap("i", "<A-j>", { desc = "Move Down" })
unmap("i", "<A-k>", { desc = "Move Up" })
unmap("v", "<A-j>", { desc = "Move Down" })
unmap("v", "<A-k>", { desc = "Move Up" })

map("v", "<C-j>", ":<C-u>execute \"'<,'>move '>+\" . v:count1<cr>gv=gv", { desc = "Move Down" })
map("v", "<C-k>", ":<C-u>execute \"'<,'>move '<-\" . (v:count1 + 1)<cr>gv=gv", { desc = "Move Up" })

--- Select all
map("n", "<C-a>", "ggVG", { desc = "Select All" })

----- end of custom configuration -----
