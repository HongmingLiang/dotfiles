vim.pack.add({ "https://github.com/nickjvandyke/opencode.nvim.git" })

local opencode_cmd = "opencode --port"

local function tmux_opencode_pane_id()
  -- Only look at panes in the current window for a running opencode process
  local panes = vim.fn.systemlist({ "tmux", "list-panes", "-F", "#{pane_id} #{pane_current_command}" })
  for _, line in ipairs(panes) do
    local id, cmd = line:match("^(%S+)%s+(%S+)")
    if cmd == "opencode" then
      return id
    end
  end
  return nil
end

vim.g.opencode_opts = {
  server = {
    start = function()
      if not tmux_opencode_pane_id() then
        -- Create a new pane on the right in the current tmux window, detached
        vim.fn.system({ "tmux", "split-window", "-h", "-l", "33%", "-d", opencode_cmd })
      end
    end,
    stop = function()
      local pane_id = tmux_opencode_pane_id()
      if pane_id then
        vim.fn.system({ "tmux", "kill-pane", "-t", pane_id })
      end
    end,
    toggle = function()
      local pane_id = tmux_opencode_pane_id()
      if pane_id then
        vim.fn.system({ "tmux", "select-pane", "-t", pane_id })
      else
        -- Open opencode in a new pane on the right in the current tmux window
        vim.fn.system({ "tmux", "split-window", "-h", "-l", "33%", opencode_cmd })
      end
    end,
  },
}

local map = vim.keymap.set

map({ "n" }, "<leader>aa", function()
  require("opencode").ask("@buffer: ", { submit = true })
end, { desc = "Ask opencode (buffer)" })

map({ "x" }, "<leader>aa", function()
  require("opencode").ask("@this: ", { submit = true })
end, { desc = "Ask opencode…" })

map({ "n" }, "<leader>at", function()
  require("opencode").toggle()
end, { desc = "Toggle opencode" })

map({ "n", "x" }, "<leader>as", function()
  require("opencode").select()
end, { desc = "Execute opencode action…" })

map({ "x" }, "go", function()
	return require("opencode").operator("@this ")
end, { desc = "Add range to opencode", expr = true })

map("n", "go", function()
	return require("opencode").operator("@this ") .. "_"
end, { desc = "Add line to opencode", expr = true })

map("n", "<C-A-u>", function()
  require("opencode").command("session.half.page.up")
end, { desc = "Scroll opencode up" })

map("n", "<C-A-d>", function()
  require("opencode").command("session.half.page.down")
end, { desc = "Scroll opencode down" })
