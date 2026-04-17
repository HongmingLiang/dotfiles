-- lua/config/FloatingTerminal.lua
-- ref: https://github.com/radleylewis/nvim-lite/blob/master/init.lua

local api, fn, cmd = vim.api, vim.fn, vim.cmd

local augroup = api.nvim_create_augroup("FloatingTerminal", { clear = true })

api.nvim_create_autocmd("TermOpen", {
  group = augroup,
  callback = function()
    vim.opt_local.number = false
    vim.opt_local.relativenumber = false
    vim.opt_local.signcolumn = "no"
  end,
})

-- Single floating terminal state shared across the session
local terminal_state = { buf = nil, win = nil, is_open = false, job_id = nil }

local function is_valid_win(win)
  return win and api.nvim_win_is_valid(win)
end

local function is_valid_buf(buf)
  return buf and api.nvim_buf_is_valid(buf)
end

local function ensure_terminal_buffer()
  if not is_valid_buf(terminal_state.buf) then
    terminal_state.buf = api.nvim_create_buf(false, true)
    vim.bo[terminal_state.buf].bufhidden = "hide"
  end
end

local function close_terminal_window()
  if terminal_state.is_open and is_valid_win(terminal_state.win) then
    api.nvim_win_close(terminal_state.win, false)
    terminal_state.is_open = false
  end
end

local function start_shell()
  -- Ensure we always track the active job for this terminal buffer
  terminal_state.job_id = fn.jobstart({ os.getenv("SHELL") }, { term = true })

  if is_valid_buf(terminal_state.buf) then
    -- Clear job_id when the terminal job for this buffer exits
    api.nvim_create_autocmd("TermClose", {
      buffer = terminal_state.buf,
      callback = function()
        terminal_state.job_id = nil
      end,
      once = false,
    })
  end
end

local function FloatingTerminal()
  if terminal_state.is_open and is_valid_win(terminal_state.win) then
    close_terminal_window()
    return
  end

  ensure_terminal_buffer()

  local width = math.floor(vim.o.columns * 0.95)
  local height = math.floor(vim.o.lines * 0.95)
  local row = math.floor((vim.o.lines - height) / 2 - 3)
  local col = math.floor((vim.o.columns - width) / 2)

  terminal_state.win = api.nvim_open_win(terminal_state.buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    border = "bold",
  })

  vim.wo[terminal_state.win].winblend = 0
  vim.wo[terminal_state.win].winhighlight = "Normal:FloatingTermNormal,FloatBorder:FloatingTermBorder"
  api.nvim_set_hl(0, "FloatingTermNormal", { bg = "none" })
  api.nvim_set_hl(0, "FloatingTermBorder", { bg = "none", fg = "#89b4fa" })

  -- If the buffer is still empty, this is the first time we attach a shell
  local has_terminal = false
  local lines = api.nvim_buf_get_lines(terminal_state.buf, 0, -1, false)
  for _, line in ipairs(lines) do
    if line ~= "" then
      has_terminal = true
      break
    end
  end
  if not has_terminal then
    start_shell()
  end

  terminal_state.is_open = true
  cmd("startinsert")

  api.nvim_create_autocmd("BufLeave", {
    buffer = terminal_state.buf,
    callback = function()
      close_terminal_window()
    end,
    once = true,
  })
end

local function ensure_terminal()
  -- Ensure terminal buffer exists
  ensure_terminal_buffer()

  -- If the window is not open, reuse the toggle logic to open it
  if not terminal_state.is_open or not is_valid_win(terminal_state.win) then
    FloatingTerminal()
  end

  -- If we have a job_id, check whether it is still running
  if terminal_state.job_id then
    local status = fn.jobwait({ terminal_state.job_id }, 0)[1]
    -- -1 means running; anything else means finished/invalid
    if status ~= -1 then
      terminal_state.job_id = nil
    end
  end

  -- No active job: start a new shell attached to current terminal buffer
  if not terminal_state.job_id then
    if is_valid_win(terminal_state.win) then
      api.nvim_set_current_win(terminal_state.win)
    end
    start_shell()
  end
end

local function SendToFloatingTerminal(command)
  if not command or command == "" then
    return
  end

  ensure_terminal()

  if is_valid_win(terminal_state.win) then
    api.nvim_set_current_win(terminal_state.win)
    cmd("startinsert")
  end

  if terminal_state.job_id then
    api.nvim_chan_send(terminal_state.job_id, command .. "\n")
  end
end

vim.keymap.set("n", "<leader>t", FloatingTerminal, { noremap = true, silent = true, desc = "Toggle floating terminal" })
vim.keymap.set("t", "<Esc>", function()
  close_terminal_window()
end, { noremap = true, silent = true, desc = "Close floating terminal" })

return {
  toggle = FloatingTerminal,
  send = SendToFloatingTerminal,
}
