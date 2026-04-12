vim.pack.add({ "https://github.com/nvim-mini/mini.nvim.git" })

vim.api.nvim_create_autocmd("UIEnter", {
  once = true,
  callback = function()
    vim.schedule(function()
      require("mini.icons").setup({})
    end)
  end,
})

vim.api.nvim_create_autocmd({ "InsertEnter", "CmdlineEnter", "LspAttach" }, {
  once = true,
  callback = function()
    require("mini.ai").setup({})

    require("mini.pairs").setup({
      modes = { insert = true, command = true, terminal = false },
      -- skip autopair when next character is one of these
      skip_next = [=[[%w%%%'%[%"%.%`%$]]=],
      -- skip autopair when the cursor is inside these treesitter nodes
      skip_ts = { "string" },
    })

    require("mini.surround").setup({
      mappings = {
        add = "gsa",
        delete = "gsd",
        replace = "gsr",
        find = "gsf",
        find_left = "gsF",
        highlight = "gsh",
      },
    })
    require("which-key").add({
      { mode = { "n", "x", "v" }, "gs", group = "mini.surround" },
    })
  end,
})
