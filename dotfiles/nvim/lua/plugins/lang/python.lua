vim.pack.add({ "https://github.com/linux-cultist/venv-selector.nvim.git" })

local initialized = false
local function setup()
  if initialized then return
  end
  require("venv-selector").setup({
    options = {
      notify_user_on_venv_activation = true,
      override_notify = false,
    },
  })
  initialized = true
end

vim.api.nvim_create_autocmd("FileType", {
  once = true,
  pattern = { "python" },
  callback = function()
    vim.keymap.set("n", "<leader>cv", function()
      setup()
      vim.cmd("VenvSelect")
    end, { desc = "Select VirtualEnv" })
  end,
})
