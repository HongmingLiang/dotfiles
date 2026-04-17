-- bufferline.nvim

local function plugin_available(module)
  local ok, _ = pcall(require, module)
  return ok
end
local has_snacks = plugin_available("snacks.picker")

local config = {
  options = {
    always_show_bufferline = true,
    offsets = {
      {
        filetype = "snacks_layout_box",
      },
    },
    diagnostics = "nvim_lsp",
    diagnostics_indicator = function(_, _, diagnostics_dict)
      local s = ""
      local diagnostics_icons = require("config.icons").diagnostics
      for e, n in pairs(diagnostics_dict) do
        local sym = e == "error" and diagnostics_icons.Error
          or (e == "warning" and diagnostics_icons.Warn or diagnostics_icons.Info)
        s = s .. n .. sym
      end
      return s
    end,
  },
}

if plugin_available("catppuccin") then
  config.highlights = require("catppuccin.special.bufferline").get_theme()
end
if has_snacks then
  -- stylua: ignore
  config.options.close_command = function(n) Snacks.bufdelete(n) end
  -- stylua: ignore
  config.options.right_mouse_command = function(n) Snacks.bufdelete(n) end
end

vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  once = true,
  callback = function()
    require("bufferline").setup(config)
  end,
})

-- keymaps to navigate buffers
local function map(mode, key, r, desc)
  vim.keymap.set(mode, key, r, { desc = desc })
end

map({ "n" }, "<leader>bh", "<cmd>BufferLineCyclePrev<cr>", "Previ buff")
map({ "n" }, "<leader>bl", "<cmd>BufferLineCycleNext<cr>", "Next buff")
map({ "n" }, "[b", "<cmd>BufferLineCyclePrev<cr>", "Prev buff")
map({ "n" }, "]b", "<cmd>BufferLineCycleNext<cr>", "Next buff")
map({ "n" }, "[B", "<cmd>BufferLineMovePrev<cr>", "Move buff prev")
map({ "n" }, "]B", "<cmd>BufferLineMoveNext<cr>", "Move buff next")
map({ "n" }, "<S-h>", "<cmd>BufferLineCyclePrev<cr>", "Prev buff")
map({ "n" }, "<S-l>", "<cmd>BufferLineCycleNext<cr>", "Next buff")
map({ "n" }, "<leader>bg", "<cmd>BufferLinePick<cr>", "Pick buff")
map({ "n" }, "<leader>bp", "<cmd>BufferLineTogglePin<cr>", "Toggle pin")

map("n", "<leader>bd", function()
  if has_snacks then
    Snacks.bufdelete()
  else
    vim.cmd("bdelete")
  end
end, "Delete Buffer")
map("n", "<leader>bo", function()
  Snacks.bufdelete.other()
end, "Delete Other Buffers")
