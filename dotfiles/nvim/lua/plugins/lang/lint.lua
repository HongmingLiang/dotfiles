-- lua/plugins/lint.lua
vim.pack.add({ "https://github.com/mfussenegger/nvim-lint.git" })

local languages = require("plugins.lang.languages")

require("lint").linters_by_ft = languages.get_linters_by_ft()

vim.api.nvim_create_autocmd({ "BufWritePost", "BufReadPost", "InsertLeave" }, {
	group = vim.api.nvim_create_augroup("UserLint", { clear = true }),
	callback = function()
		require("lint").try_lint()
	end,
})
