vim.pack.add({
  {
    src = "https://github.com/saghen/blink.cmp",
    version = vim.version.range("1.*"),
  },
})

local config = {
  sources = {
    default = { "lsp", "buffer", "snippets", "path" },
  },
  completion = {
    menu = { border = "bold" },
    documentation = {
      auto_show = true,
      window = {
        border = "rounded",
        scrollbar = true,
      }, -- end of completion.documentation.window
    }, -- end of completion.documentation
    ghost_text = { -- pick from https://github.com/Jacky-Lzx/nvim.tutorial.config/blob/main/lua/plugins/completion.lua
      enabled = true,
      show_with_selection = true, -- Show the ghost text when an item has been selected
      show_without_selection = true, -- Show the ghost text when no item has been selected, defaulting to the first item
      show_with_menu = true, -- Show the ghost text when the menu is open
      show_without_menu = true, -- Show the ghost text when the menu is closed
    }, -- end of completion.ghost_text
  }, -- end of completion
  -- signature = { enabled = true },
  cmdline = {
    keymap = { preset = "inherit" },
    completion = { menu = { auto_show = true } },
  },
  keymap = {
    ["<C-u>"] = { "scroll_documentation_up", "fallback" },
    ["<C-d>"] = { "scroll_documentation_down", "fallback" },
    ["<Tab>"] = { "select_and_accept", "fallback" },
    ["<A-j>"] = {
      function(cmp)
        return cmp.select_next({ auto_insert = false })
      end,
      "fallback",
    },
    ["<A-k>"] = {
      function(cmp)
        return cmp.select_prev({ auto_insert = false })
      end,
      "fallback",
    },
    ["<A-/>"] = {
      function(cmp)
        if cmp.is_menu_visible() then
          return cmp.hide()
        else
          return cmp.show()
        end
      end,
      "fallback",
    },
  }, -- end of keymap
}

vim.api.nvim_create_autocmd({ "InsertEnter", "CmdlineEnter", "LspAttach" }, {
  once = true,
  callback = function()
    -- check for copilot and add it as a source if available
    local has_copilot, _ = pcall(vim.pack.get, { "blink-copilot" }, { info = false })
    if has_copilot then
      table.insert(config.sources.default, 1, "copilot")
      config.sources.providers = {
        copilot = {
          name = "copilot",
          module = "blink-copilot",
          score_offset = 100,
          async = true,
        },
      }
    end

    require("blink.cmp").setup(config)
  end,
})
