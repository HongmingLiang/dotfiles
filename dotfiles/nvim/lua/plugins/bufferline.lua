vim.pack.add({ "https://github.com/akinsho/bufferline.nvim.git" })

local function plugin_available(module)
  local ok, _ = pcall(require, module)
  return ok
end

local config = {
  options = {
    always_show_bufferline = false,
    offsets = {
      {
        filetype = "snacks_layout_box",
      },
    },

    diagnostics_indicator = function(count, level, diagnostics_dict, context)
      local s = " "
      for e, n in pairs(diagnostics_dict) do
        local sym = e == "error" and " " or (e == "warning" and " " or " ")
        s = s .. n .. sym
      end
      return s
    end,
    -- stylua: ignore
    close_command = function(n) Snacks.bufdelete(n) end,
    -- stylua: ignore
    right_mouse_command = function(n) Snacks.bufdelete(n) end,
  },
}

if plugin_available("catppuccin") then
  config.highlights = require("catppuccin.special.bufferline").get_theme()
end

require("bufferline").setup(config)

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
  Snacks.bufdelete()
end, "Delete Buffer")
map("n", "<leader>bo", function()
  Snacks.bufdelete.other()
end, "Delete Other Buffers")
