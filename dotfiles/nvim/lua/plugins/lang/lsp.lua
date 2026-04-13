vim.pack.add({ "https://github.com/neovim/nvim-lspconfig.git" })

-- Known LSP servers managed by :LspToggle
local LSP_SERVERS = require("plugins.lang.languages").get_lsp_servers()

-- Per-server enable state kept in memory. Missing key = enabled by default.
local lsp_enabled = {}

local function lsp_is_enabled(name)
  local value = lsp_enabled[name]
  return value == nil and true or value
end

local function lsp_stop(name)
  for _, client in ipairs(vim.lsp.get_clients()) do
    if client.name == name and type(client.stop) == "function" then
      client.stop(client)
    end
  end
end

local function lsp_stop_all()
  for _, name in ipairs(LSP_SERVERS) do
    lsp_stop(name)
  end
end

local diagnostic_signs = {
  Error = " ",
  Warn = " ",
  Hint = "",
  Info = "",
}

vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  once = true,
  callback = function()
    vim.diagnostic.config({
      virtual_text = { prefix = "●", spacing = 4 },
      signs = {
        text = {
          [vim.diagnostic.severity.ERROR] = diagnostic_signs.Error,
          [vim.diagnostic.severity.WARN] = diagnostic_signs.Warn,
          [vim.diagnostic.severity.INFO] = diagnostic_signs.Info,
          [vim.diagnostic.severity.HINT] = diagnostic_signs.Hint,
        },
      },
      underline = true,
      update_in_insert = false,
      severity_sort = true,
      float = {
        border = "rounded",
        source = true,
        header = "",
        prefix = "",
        focusable = false,
        style = "minimal",
      },
    })

    if lsp_is_enabled("lua_ls") then
      vim.lsp.config("lua_ls", {
        cmd = { "lua-language-server" },
        filetypes = { "lua" },
        root_markers = { ".luarc.json", ".git" },
        settings = {
          Lua = {
            runtime = { version = "LuaJIT" },
            diagnostics = { globals = { "vim" } },
            workspace = { library = vim.api.nvim_get_runtime_file("", true) },
            telemetry = { enable = false },
          },
        },
      })
    end

    if lsp_is_enabled("pyright") then
      vim.lsp.config("pyright", {
        filetypes = { "python" },
        root_markers = { "pyproject.toml", ".git" },
      })
    end

    if lsp_is_enabled("bashls") then
      vim.lsp.config("bashls", {
        cmd = { "bash-language-server", "start" },
        filetypes = { "sh", "bash" },
        root_markers = { ".git" },
      })
    end
  end,
})

-- Unified LSP toggle command (no persistence across sessions).
-- Usage:
--   :LspToggle          -> if any enabled, disable all; if all disabled, enable all
--   :LspToggle lua_ls   -> toggle a single server
vim.api.nvim_create_user_command("LspToggle", function(opts)
  local function set_all(enabled)
    for _, name in ipairs(LSP_SERVERS) do
      lsp_enabled[name] = enabled
    end
  end

  -- Has argument: toggle a single server
  if opts.args ~= "" then
    local name = opts.args
    local now_enabled = not lsp_is_enabled(name)
    lsp_enabled[name] = now_enabled

    vim.notify(
      string.format("%s %s", name, now_enabled and "enabled" or "disabled"),
      vim.log.levels.INFO,
      { title = "LSP" }
    )

    if now_enabled then
      vim.notify("Restart Neovim to start the server.", vim.log.levels.INFO, { title = "LSP" })
    else
      lsp_stop(name)
      vim.notify("Stopped running clients for " .. name, vim.log.levels.INFO, { title = "LSP" })
      vim.notify("All servers are on by default, lsp status will not be stored", vim.log.levels.WARN, { title = "LSP" })
    end
    return
  end

  -- No argument: toggle all servers together
  local any_enabled = false
  for _, name in ipairs(LSP_SERVERS) do
    if lsp_is_enabled(name) then
      any_enabled = true
      break
    end
  end

  local enable_all = not any_enabled
  set_all(enable_all)

  vim.notify(enable_all and "All LSPs enabled" or "All LSPs disabled", vim.log.levels.INFO, { title = "LSP" })

  if enable_all then
    vim.notify("Restart Neovim to start the servers.", vim.log.levels.INFO, { title = "LSP" })
  else
    lsp_stop_all()
    vim.notify("Stopped all running LSP clients.", vim.log.levels.INFO, { title = "LSP" })
    vim.notify("All servers are on by default, lsp status will not be stored", vim.log.levels.WARN, { title = "LSP" })
  end
end, {
  nargs = "?",
  complete = function()
    return LSP_SERVERS
  end,
})
vim.keymap.set("n", "<leader>ct", "<cmd>LspToggle<cr>", { desc = "Toggle All LSP" })

-- Show current LSP status for managed servers
vim.api.nvim_create_user_command("LspStatus", function()
  local clients_by_name = {}
  for _, client in ipairs(vim.lsp.get_clients()) do
    local list = clients_by_name[client.name] or {}
    table.insert(list, client)
    clients_by_name[client.name] = list
  end

  local lines = {}
  for _, name in ipairs(LSP_SERVERS) do
    local enabled = lsp_is_enabled(name)
    local running = clients_by_name[name] or {}
    table.insert(lines, string.format("%-8s config:%-8s running:%d", name, enabled and "on" or "off", #running))
  end

  vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "LSP Status" })
end, {})
vim.keymap.set("n", "<leader>cl", "<cmd>LspStatus<cr>", { desc = "Lsp Status" })

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("LspConfig", { clear = true }),
  callback = function(ev)
    local function map(mode, key, r, desc)
      vim.keymap.set(mode, key, r, { buffer = ev.buf, desc = desc })
    end
    map("n", "<leader>cn", vim.lsp.buf.rename, "rename")
    map("n", "<leader>ca", vim.lsp.buf.code_action, "Code Action")

    local diagnostic_goto = function(next, severity)
      return function()
        vim.diagnostic.jump({
          count = (next and 1 or -1) * vim.v.count1,
          severity = severity and vim.diagnostic.severity[severity] or nil,
          float = true,
        })
      end
    end
    map("n", "]d", diagnostic_goto(true), "Next Diagnostic")
    map("n", "[d", diagnostic_goto(false), "Prev Diagnostic")
    map("n", "]d", diagnostic_goto(true), "Next Diagnostic")
    map("n", "[d", diagnostic_goto(false), "Prev Diagnostic")
    map("n", "]e", diagnostic_goto(true, "ERROR"), "Next Error")
    map("n", "[e", diagnostic_goto(false, "ERROR"), "Prev Error")
    map("n", "]w", diagnostic_goto(true, "WARN"), "Next Warning")
    map("n", "[w", diagnostic_goto(false, "WARN"), "Prev Warning")

    map("n", "K", vim.lsp.buf.hover, "hover")
    map("n", "<leader>cd", vim.diagnostic.open_float, "Line diagnostic")

    local has_snacks, _ = pcall(require, "snacks.picker")
    map("n", "gd", function()
      if has_snacks then
        Snacks.picker.lsp_definitions()
      else
        vim.lsp.buf.definition()
      end
    end, "Goto definition")
    map("n", "gD", function()
      if has_snacks then
        Snacks.picker.lsp_declarations()
      else
        vim.lsp.buf.declaration()
      end
    end, "Goto declaration")
    map("n", "gr", function()
      if has_snacks then
        Snacks.picker.lsp_references()
      else
        vim.lsp.buf.references()
      end
    end, "Goto references")
    map("n", "gi", function()
      if has_snacks then
        Snacks.picker.lsp_implementations()
      else
        vim.buf.buf.implementation()
      end
    end, "Goto implementation")

    local default_lsp_keys = { "grr", "grn", "gra", "gri", "grt", "grx" }
    for _, key in ipairs(default_lsp_keys) do
      pcall(vim.keymap.del, "n", key)
      pcall(vim.keymap.del, "x", key)
    end

    if has_snacks then
      map("n", "[[", function()
        Snacks.words.jump(-vim.v.count1)
      end, "Prev reference")
      map("n", "]]", function()
        Snacks.words.jump(vim.v.count1)
      end, "Next reference")
    end
  end,
})
