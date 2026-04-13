vim.pack.add({ "https://github.com/nickjvandyke/opencode.nvim.git" })

local opencode_window = "opencode"
local opencode_cmd = "opencode --port"

local function tmux_window_exists()
	local windows = vim.fn.systemlist({ "tmux", "list-windows", "-F", "#W" })
	return vim.tbl_contains(windows, opencode_window)
end

vim.g.opencode_opts = {
	server = {
		start = function()
			if not tmux_window_exists() then
				vim.fn.system({ "tmux", "new-window", "-d", "-n", opencode_window, opencode_cmd })
			end
		end,
		stop = function()
			if tmux_window_exists() then
				vim.fn.system({ "tmux", "kill-window", "-t", opencode_window })
			end
		end,
		toggle = function()
			if tmux_window_exists() then
				vim.fn.system({ "tmux", "select-window", "-t", opencode_window })
			else
				vim.fn.system({ "tmux", "new-window", "-n", opencode_window, opencode_cmd })
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
