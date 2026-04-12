vim.pack.add({ "https://github.com/folke/snacks.nvim.git" })

require("snacks").setup({
  bigfile = { enable = true },
  explorer = { enable = true },
  indent = { enable = true },
  words = { enable = true },

  picker = {
    -- ref: https://www.lazyvim.org/extras/editor/snacks_picker
    enable = true,
    win = {
      input = {
        keys = {
          ["<a-s>"] = { "flash", mode = { "n", "i" } },
          ["s"] = { "flash" },
          ["<c-u>"] = { "preview_scroll_up", mode = { "i", "n" } },
          ["<c-d>"] = { "preview_scroll_down", mode = { "i", "n" } },
        },
      },
    },
    actions = {
      flash = function(picker)
        require("flash").jump({
          pattern = "^",
          label = { after = { 0, 0 } },
          search = {
            mode = "search",
            exclude = {
              function(win)
                return vim.bo[vim.api.nvim_win_get_buf(win)].filetype ~= "snacks_picker_list"
              end,
            },
          },
          action = function(match)
            local idx = picker.list:row2idx(match.pos[1])
            picker.list:_move(idx, true, true)
          end,
        })
      end,
    },
  },

  dashboard = {
    enable = true,
    preset = {
      keys = {
        { icon = " ", key = "f", desc = "Find File", action = ":lua Snacks.dashboard.pick('files')" },
        { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
        { icon = " ", key = "g", desc = "Find Text", action = ":lua Snacks.dashboard.pick('live_grep')" },
        { icon = " ", key = "r", desc = "Recent Files", action = ":lua Snacks.dashboard.pick('oldfiles')" },
        {
          icon = " ",
          key = "c",
          desc = "Config",
          action = ":lua Snacks.dashboard.pick('files', {cwd = vim.fn.stdpath('config')})",
        },
        { icon = " ", key = "q", desc = "Quit", action = ":qa" },
      },
    },
    sections = {
      { section = "header" },
      { section = "keys", gap = 1, padding = 1 },
      { pane = 2, icon = " ", title = "Recent Files", section = "recent_files", indent = 2, padding = 1 },
      { pane = 2, icon = " ", title = "Projects", section = "projects", indent = 2, padding = 1 },
      {
        pane = 2,
        icon = " ",
        title = "Git Status",
        section = "terminal",
        enabled = function()
          return Snacks.git.get_root() ~= nil
        end,
        cmd = "git status --short --branch --renames",
        height = 5,
        padding = 1,
        ttl = 5 * 60,
        indent = 3,
      },
    },
  },

  scroll = { enable = true },
  notifier = { enable = true },
})

local map = vim.keymap.set

map({ "n", "v", "x" }, "<leader>e", function()
  Snacks.explorer()
end, { desc = "Toggle file explorer" })

-- Snacks.picker
map({ "n" }, "<leader><space>", function()
  Snacks.picker.files()
end, { desc = "File picker" })

map({ "n" }, "<leader>gd", function()
  Snacks.picker.git_diff()
end, { desc = "Git diff" })
map({ "n" }, "<leader>gs", function()
  Snacks.picker.git_status()
end, { desc = "Git status" })
if vim.fn.executable("lazygit") == 1 then
  map("n", "<leader>gg", function()
    Snacks.lazygit()
  end, { desc = "Lazygit" })
end

require("which-key").add({ { mode = { "n" }, "<leader>s", group = "search" } })
map({ "n" }, "<leader>sn", function()
  Snacks.picker.notifications()
end, { desc = "Notification History" })
map({ "n" }, "<leader>su", function()
  Snacks.picker.undo()
end, { desc = "Undo tree" })
map({ "n" }, "<leader>sh", function()
  Snacks.picker.help()
end, { desc = "Help" })
map({ "n" }, "<leader>sr", function()
  Snacks.picker.registers()
end, { desc = "Registers" })
map({ "n" }, "<leader>sk", function()
  Snacks.picker.keymaps()
end, { desc = "Keymaps" })
map({ "n" }, "<leader>s/", function()
  Snacks.picker.search_history()
end, { desc = "Search history" })
map({ "n" }, "<leader>sd", function()
  Snacks.picker.diagnostics()
end, { desc = "Diagnostics" })
map({ "n" }, "<leader>sd", function()
  Snacks.picker.diagnostics()
end, { desc = "Diagnostics" })
map({ "n" }, "<leader>sc", function()
  Snacks.picker.commands()
end, { desc = "Commands" })
map({ "n" }, "<leader>s:", function()
  Snacks.picker.commands()
end, { desc = "Commands" })
map({ "n" }, "<leader>sC", function()
  Snacks.picker.command_history()
end, { desc = "Command history" })
map({ "n" }, "<leader>sa", function()
  Snacks.picker.autocmds()
end, { desc = "Autocmds" })
map({ "n" }, "<leader>sb", function()
  Snacks.picker.grep_buffers()
end, { desc = "Grep buffer" })
map({ "n" }, "<leader>sB", function()
  Snacks.picker.buffers()
end, { desc = "Buffers" })
map({ "n" }, "<leader>sl", function()
  Snacks.picker.lines()
end, { desc = "Lines" })
map({ "n" }, "<leader>sp", function()
  Snacks.picker.projects()
end, { desc = "Projects" })
