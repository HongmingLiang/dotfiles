-- lua/config/keymaps.lua

vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

local map = vim.keymap.set

map({ "i" }, "jk", "<ESC>l", { desc = "Escape to normal mode" })
map({ "n", "x" }, "<leader>qq", "<CMD>qa<CR>", { desc = "Quit all" })
map({ "n", "x" }, "<leader>qr", "<CMD>restart<CR>", { desc = "Restart" })
map({ "n", "x" }, "qq", "<CMD>:q<CR>", { desc = "Quit" })

map({ "n", "x" }, "d", '"_d', { desc = "Delete without yanking" })
map("n", "D", '"_D', { desc = "Delete to EOL without yanking" })

map({ "x" }, "<leader>y", '"+y', { desc = "Yank to system clipboard" })
map("n", "<leader>Y", '"+Y', { desc = "Yank line to system clipboard" })
map({ "n", "x" }, "<leader>ps", '"+p', { desc = "Paste from system clipboard" })

-- save file
map({ "i", "x", "n", "s" }, "<C-s>", "<cmd>w<cr><esc>", { desc = "Save File" })
map({ "x", "n" }, "<leader>w", "<cmd>w<cr>", { desc = "Write" })

-- Add undo break-points
map("i", ",", ",<c-g>u")
map("i", ".", ".<c-g>u")
map("i", ";", ";<c-g>u")

-- better up/down
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "<Down>", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })
map({ "n", "x" }, "<Up>", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })

-- move lines or blocks up/down
map("v", "<C-j>", ":<C-u>execute \"'<,'>move '>+\" . v:count1<cr>gv=gv", { desc = "Move Down" })
map("v", "<C-k>", ":<C-u>execute \"'<,'>move '<-\" . (v:count1 + 1)<cr>gv=gv", { desc = "Move Up" })
-- map("n", "<C-j>", "<cmd>execute 'move .+' . v:count1<cr>==", { desc = "Move Down" })
-- map("n", "<C-k>", "<cmd>execute 'move .-' . (v:count1 + 1)<cr>==", { desc = "Move Up" })
-- map("i", "<C-k>", "<esc><cmd>m .-2<cr>==gi", { desc = "Move Up" })
-- map("i", "<C-j>", "<esc><cmd>m .+1<cr>==gi", { desc = "Move Down" })

-- better indenting
map("x", "<", "<gv")
map("x", ">", ">gv")

-- buffers
map("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "[b", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "]b", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>`", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>bD", "<cmd>:bd<cr>", { desc = "Delete Buffer and Window" })

-- Move to window using the <ctrl> hjkl keys
map("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
map("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
map("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
map("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })

-- split window
map({ "n" }, "<leader>\\", ":vsplit<cr>", { desc = "Split window right" })
map({ "n" }, "<leader>-", ":split<cr>", { desc = "Split window below" })
map({ "n" }, "<c-w>d", ":q<cr>", { silent = true, desc = "Close window" })

-- Resize window using <ctrl> arrow keys
map("n", "<C-Up>", "<cmd>resize +2<cr>", { desc = "Increase Window Height" })
map("n", "<C-Down>", "<cmd>resize -2<cr>", { desc = "Decrease Window Height" })
map("n", "<C-Left>", "<cmd>vertical resize -2<cr>", { desc = "Decrease Window Width" })
map("n", "<C-Right>", "<cmd>vertical resize +2<cr>", { desc = "Increase Window Width" })

-- Clear search and stop snippet on escape
map({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("nohlsearch")
  return "<esc>"
end, { expr = true, desc = "Escape and clear search highlight" })

-- toggle comment
map("v", "<C-_>", "gc", { desc = "Toggle Comment", remap = true })
map("n", "<C-_>", "gcc", { desc = "Toggle Comment", remap = true })
map("v", "<C-/>", "gc", { desc = "Toggle Comment", remap = true })
map("n", "<C-/>", "gcc", { desc = "Toggle Comment", remap = true })

-- keep cursor in the center while scorlling and searching
map({ "n" }, "n", "nzzzv", { desc = "Next search result (centered)" })
map({ "n" }, "N", "Nzzzv", { desc = "Previous search result (centered)" })
-- map({ "n" }, "<C-d>", "<C-d>zz", { desc = "Half page down (centered)" })
-- map({ "n" }, "<C-u>", "<C-u>zz", { desc = "Half page down (centered)" })

map({ "n" }, "<leader>pp", function()
  local path = vim.fn.expand("%:p")
  vim.fn.setreg("+", path)
  print("Copy current file path:", path)
end, { desc = "Copy current file path" })
