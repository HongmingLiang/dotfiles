-- lua/plugins/lualine.lua
vim.pack.add({ "https://github.com/nvim-lualine/lualine.nvim" })

local diagnostic_signs = {
  Error = " ",
  Warn = " ",
  Hint = " ",
  Info = " ",
}

local function is_snacks_explorer_ft(ft)
  return ft == "snacks_picker_list" or ft == "snacks_picker_input" or ft == "snacks_picker_preview"
end

local function file_icon()
  local ok, _ = pcall(require, "mini.icons")
  if not ok or not _G.MiniIcons then
    return ""
  end

  local name = vim.api.nvim_buf_get_name(0)
  local icon
  if name ~= "" then
    icon = select(1, MiniIcons.get("file", name))
  else
    icon = select(1, MiniIcons.get("filetype", vim.bo.filetype))
  end
  return icon or ""
end

local function get_lsp_root(bufnr)
  local clients = vim.lsp.get_clients({ bufnr = bufnr })
  for _, client in ipairs(clients) do
    local wf = client.config and client.config.workspace_folders
    if wf and wf[1] and wf[1].name then
      return wf[1].name
    end
    local rd = client.config and client.config.root_dir
    if type(rd) == "string" and rd ~= "" then
      return rd
    end
  end
end

local function get_git_root(path)
  local git = vim.fs.find(".git", { path = path, upward = true })[1]
  if git then
    return vim.fs.dirname(git)
  end
end

local function get_rootdir(bufnr, file_dir)
  return get_lsp_root(bufnr) or get_git_root(file_dir) or vim.uv.cwd()
end

local function shorten_keep_tail(path, max_len)
  if #path <= max_len then
    return path
  end
  local p = vim.fn.pathshorten(path)
  if #p <= max_len then
    return p
  end
  if max_len <= 1 then
    return "…"
  end
  return "…" .. p:sub(-(max_len - 1))
end

local function pretty_path()
  local bufnr = vim.api.nvim_get_current_buf()
  local full = vim.api.nvim_buf_get_name(bufnr)
  if full == "" then
    return ""
  end
  local file_dir = vim.fs.dirname(full)
  local root = get_rootdir(bufnr, file_dir)
  local rel = vim.fs.relpath(root, full)
  local display
  if rel then
    display = rel
  else
    display = vim.fn.fnamemodify(full, ":~")
  end
  local win_width = vim.fn.winwidth(0)
  local max_len = math.floor(win_width * 0.35)
  max_len = math.max(30, math.min(max_len, 60))
  return shorten_keep_tail(display, max_len)
end

require("lualine").setup({
  options = {
    theme = "auto",
    globalstatus = true,
    disabled_filetypes = {
      statusline = { "dashboard", "alpha", "ministarter", "snacks_dashboard" },
    },
  },
  sections = {
    lualine_a = { "mode" },
    lualine_b = { "branch" },
    lualine_c = {
      {
        file_icon,
        separator = "",
        padding = { left = 1, right = 0 },
        cond = function()
          return not is_snacks_explorer_ft(vim.bo.filetype)
        end,
      },
      { pretty_path },
      {
        "diagnostics",
        symbols = {
          error = diagnostic_signs.Error,
          warn = diagnostic_signs.Warn,
          info = diagnostic_signs.Info,
          hint = diagnostic_signs.Hint,
        },
      },
    },
    lualine_x = {
      {
        "diff",
        source = function()
          local gs = vim.b.gitsigns_status_dict
          if gs then
            return { added = gs.added, modified = gs.changed, removed = gs.removed }
          end
        end,
        cond = function()
          return vim.fn.winwidth(0) > 90
        end,
      },
      {
        function()
          return require("noice").api.status.command.get()
        end,
        cond = function()
          return vim.fn.winwidth(0) > 110 and package.loaded["noice"] and require("noice").api.status.command.has()
        end,
      },
    },
    lualine_y = {
      { "progress", separator = " ", padding = { left = 1, right = 0 } },
      { "location", padding = { left = 0, right = 1 } },
    },
    lualine_z = {
      function()
        return " " .. os.date("%R")
      end,
    },
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = {},
    lualine_x = {},
    lualine_y = {},
    lualine_z = {},
  },
})
