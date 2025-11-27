return {
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        sh = { "shfmt" },
        lua = { "stylua" },
      },
      formatters = {
        shfmt = { prepend_args = { "--case-indent", "--space-redirects" } },
      },
    }, -- end of `opts`
  }, -- end of stevearc/conform.nvim
} -- end of return
