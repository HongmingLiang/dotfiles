-- lua/plugins/lang/format.lua

local initialized = false
local function setup()
  local languages = require("plugins.lang.languages")
  require("conform").setup({
    formatters_by_ft = languages.get_formatters_by_ft(),
    -- format_on_save = {
    --   timeout_ms = 500,
    --   lsp_format = "fallback",
    -- },
    formatters = {
      stylua = {
        prepend_args = { "--indent-type", "Spaces", "--indent-width", "2" },
        ignore_error = true,
      },
      shfmt = {
        prepend_args = { "--case-indent", "--space-redirects", "-i", "2" },
      },
    },
  })
  initialized = true
end

vim.keymap.set("n", "<leader>cf", function()
  if not initialized then setup() end
  require("conform").format({ async = true, lsp_fallback = true })
end, { desc = "Format code" })
