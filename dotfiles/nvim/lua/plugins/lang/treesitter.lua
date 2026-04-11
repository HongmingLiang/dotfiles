vim.pack.add({
  {
    src = "https://github.com/nvim-treesitter/nvim-treesitter.git",
    branch = "main",
    build = ":TSUpdate",
  }
})

require("nvim-treesitter").setup({
  auto_install = false,
  highlight = { enable = true },
  indent = { enable = true },
})

-- install missing plugins
vim.api.nvim_create_autocmd("VimEnter", {
  callback = function()
    -- check tree-sitter CLI
    local has_tree_sitter_cli = vim.fn.executable("tree-sitter") == 1
    if not has_tree_sitter_cli then
      vim.notify("tree-sitter CLI is not installed, installing with mason", vim.log.levels.WARN)
      vim.cmd("MasonInstall tree-sitter-cli")
    end

    local langs = require("plugins.lang.languages").get_treesitter_parsers()
    local installed = require("nvim-treesitter.config").get_installed()
    local missing = vim.tbl_filter(function(lang)
      return not vim.list_contains(installed, lang)
    end, langs)
    if #missing > 0 then
      require("nvim-treesitter.install").install(missing, { summary = true })
    end
  end,
})

vim.api.nvim_create_autocmd('FileType', {
  pattern = vim.tbl_keys(require("plugins.lang.languages").languages),
  callback = function() vim.treesitter.start() end,
})
