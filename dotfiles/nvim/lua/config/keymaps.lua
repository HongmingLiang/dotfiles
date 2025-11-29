-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

----- My custom configuration -----
local map = vim.keymap.set
local unmap = vim.keymap.del

-- fast escape to normal mode
map("i", "jk", "<Esc>l", { desc = "Escape to normal mode" })
-- fast quit
map({ "n", "x" }, "qq", "<CMD>:q<CR>", { desc = "Quit" })
-- fast quit all
map({ "n", "x" }, "Q", "<CMD>:qa<CR>", { desc = "Quit all" })

-- fast close buffer
map("n", "W", "<leader>bd", { desc = "Close Buffer", remap = true })

---- Alt related keys----

-- set alt to move cursor
map("i", "<A-h>", "<Left>", { desc = "Cursor Move Left", noremap = true })
map("i", "<A-j>", "<Down>", { desc = "Cursor Move Down", noremap = true })
map("i", "<A-k>", "<Up>", { desc = "Cursor Move Up", noremap = true })
map("i", "<A-l>", "<Right>", { desc = "Cursor Move Right", noremap = true })

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

---- Control related keys ----

-- override <C-_> from "open Terminal" to "Toggle Comment"
-- and map <C-t> to open floating Terminal
unmap({ "n", "t" }, "<c-_>", { desc = "which_key_ignore" })
map("v", "<C-_>", "gc", { desc = "Toggle Comment", remap = true })
map("n", "<C-_>", "gcc", { desc = "Toggle Comment", remap = true })
map({ "n", "t" }, "<C-t>", function()
  Snacks.terminal(nil, { cwd = LazyVim.root() })
end, { desc = "Terminal (Root Dir)" })

--- Select all
map("n", "<C-a>", "ggVG", { desc = "Select All" })
-- undo
map("i", "<C-z>", "<Esc>ui", { desc = "Undo" })
map("n", "<C-z>", "u", { desc = "Undo" })

----- end of custom configuration -----
