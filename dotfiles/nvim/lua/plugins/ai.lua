-- AI related plugins

return {
  "yetone/avante.nvim",
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
}
