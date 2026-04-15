-- grug-far.nvim

local initialized = false
local function setup()
  if initialized then return end
  require("grug-far").setup({ headerMaxWidth = 40 })
  initialized = true
end

vim.keymap.set({ "n", "x" }, "<leader>cR", function()
  setup()
  -- ref: https://www.lazyvim.org/plugins/editor#grug-farnvim
  local ext = vim.bo.buftype == "" and vim.fn.expand("%:e")
  require("grug-far").open({
    transient = true,
    prefills = {
      filesFilter = ext and ext ~= "" and "*." .. ext or nil,
    },
  })
end, { desc = "Search and Replace" })
