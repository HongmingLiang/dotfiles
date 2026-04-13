vim.pack.add({ "https://github.com/folke/which-key.nvim.git" })

vim.keymap.set({ "n" }, "<leader>?", function()
  require("which-key").show({ global = false })
end, { desc = "Buffer Local Keymaps (which-key)" })

local wk = require("which-key")

wk.setup({
  preset = "helix",
  expand = 1,
})
wk.add({
  {
    mode = { "n", "x" },
    {
      "<leader>?",
      function()
        require("which-key").show({ global = false })
      end,
      desc = "Buffer Local Keymaps (which-key)",
    },
    { "<leader>g", group = "git" },
    { "<leader>gl", group = "git log" },
    { "<leader>gh", group = "git hunks" },
    { "<leader>c", group = "code" },
    { "<leader>u", group = "UI" },
    { "[", group = "prev" },
    { "]", group = "next" },
    { "g", group = "goto" },
    { "<leader>q", group = "quit" },
  },

  {
    "<leader>b",
    group = "buffers",
    expand = function()
      return require("which-key.extras").expand.buf()
    end,
  },
  {
    "<leader>w",
    group = "windows",
    proxy = "<c-w>",
    expand = function()
      return require("which-key.extras").expand.win()
    end,
  },

  -- better descriptions
  { "gx", desc = "Open with system app" },
})
