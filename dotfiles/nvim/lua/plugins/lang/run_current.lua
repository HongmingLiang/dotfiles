-- lua/config/run_current.lua
-- Run the current buffer in the floating terminal, using language-specific runners.

local languages = require("plugins.lang.languages")
local floating_term = require("config.FloatingTerminal")

local function build_run_command(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()

  local ft = vim.bo[bufnr].filetype
  local filepath = vim.api.nvim_buf_get_name(bufnr)

  if filepath == "" then
    return nil, "Buffer has no file name"
  end

  if vim.bo[bufnr].modified then
    return nil, "Buffer is modified, please save before running"
  end

  local runner = languages.get_runner_for_ft(ft)
  if not runner then
    return nil, "No runner configured for filetype: " .. (ft or "nil")
  end

  if type(runner) ~= "function" then
    return nil, "Runner for " .. ft .. " is not a function"
  end

  local command = runner(filepath)
  if not command or command == "" then
    return nil, "Runner for " .. ft .. " returned empty command"
  end

  return command
end

local function run_current()
  local command, err = build_run_command(0)
  if not command then
    vim.notify(err, vim.log.levels.WARN)
    return
  end

  floating_term.send(command)
end

vim.keymap.set("n", "<leader>cr", function()
  run_current()
end, { noremap = true, silent = true, desc = "Run current file in floating terminal" })
