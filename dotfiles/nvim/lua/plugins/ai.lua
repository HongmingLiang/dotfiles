-- AI related plugins

return {
  {
    "nickjvandyke/opencode.nvim",
    version = "*", -- Latest stable release
    dependencies = {
      {
        -- `snacks.nvim` integration is recommended, but optional
        ---@module "snacks" <- Loads `snacks.nvim` types for configuration intellisense
        "folke/snacks.nvim",
        optional = true,
        opts = {
          input = {}, -- Enhances `ask()`
          picker = { -- Enhances `select()`
            actions = {
              opencode_send = function(...)
                return require("opencode").snacks_picker_send(...)
              end,
            },
            win = {
              input = {
                keys = {
                  ["<a-a>"] = { "opencode_send", mode = { "n", "i" } },
                },
              },
            },
          },
          terminal = {}, -- Enables the `snacks` provider
        },
      },
    },
    config = function()
      ---@type opencode.Opts
      vim.g.opencode_opts = {
        -- Your configuration, if any; goto definition on the type or field for details
      }

      vim.o.autoread = true -- Required for `opts.events.reload`

      -- Recommended/example keymaps
      vim.keymap.set({ "n", "x" }, "<leader>aa", function()
        require("opencode").ask("@this: ", { submit = true })
      end, { desc = "Ask opencode…" })
      vim.keymap.set({ "n", "x" }, "<leader>ax", function()
        require("opencode").select()
      end, { desc = "Execute opencode action…" })
      vim.keymap.set({ "n", "t" }, "<leader>at", function()
        require("opencode").toggle()
      end, { desc = "Toggle opencode" })

      vim.keymap.set({ "n", "x" }, "<leader>ao", function()
        return require("opencode").operator("@this ")
      end, { desc = "Add range to opencode", expr = true })
      vim.keymap.set("n", "<leader>al", function()
        return require("opencode").operator("@this ") .. "_"
      end, { desc = "Add line to opencode", expr = true })

      vim.keymap.set("n", "<S-C-u>", function()
        require("opencode").command("session.half.page.up")
      end, { desc = "Scroll opencode up" })
      vim.keymap.set("n", "<S-C-d>", function()
        require("opencode").command("session.half.page.down")
      end, { desc = "Scroll opencode down" })
    end,
  },
  { -- stop using avante for now
    "yetone/avante.nvim",
    cond = false,
    enabled = false,
    opts = {
      selection = { enabled = true, hint_display = "delayed" },
      behaviour = {
        auto_approve_tool_permissions = false,
      },
    },
    keys = {
      { "<leader>aa", "<cmd>AvanteAsk<CR>", mode = { "n", "v" }, desc = "Ask Avante" },
      { "<leader>ac", "<cmd>AvanteChat<CR>", mode = { "n", "v" }, desc = "Chat with Avante" },
      { "<leader>ae", "<cmd>AvanteEdit<CR>", mode = { "n", "v" }, desc = "Edit Avante" },
      { "<leader>af", "<cmd>AvanteFocus<CR>", mode = { "n", "v" }, desc = "Focus Avante" },
      { "<leader>ah", "<cmd>AvanteHistory<CR>", mode = { "n", "v" }, desc = "Avante History" },
      { "<leader>am", "<cmd>AvanteModels<CR>", mode = { "n", "v" }, desc = "Select Avante Model" },
      { "<leader>an", "<cmd>AvanteChatNew<CR>", mode = { "n", "v" }, desc = "New Avante Chat" },
      { "<leader>ap", "<cmd>AvanteSwitchProvider<CR>", mode = { "n", "v" }, desc = "Switch Avante Provider" },
      { "<leader>ar", "<cmd>AvanteRefresh<CR>", mode = { "n", "v" }, desc = "Refresh Avante" },
      { "<leader>as", "<cmd>AvanteStop<CR>", mode = { "n", "v" }, desc = "Stop Avante" },
      { "<leader>at", "<cmd>AvanteToggle<CR>", mode = { "n", "v" }, desc = "Toggle Avante" },
    },
  },
}
