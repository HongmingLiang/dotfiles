vim.pack.add({ "https://github.com/neovim/nvim-lspconfig.git" })

local diagnostic_signs = {
  Error = " ",
  Warn = " ",
  Hint = "",
  Info = "",
}

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

-- LSP references highlight, similar to LazyVim
for _, hl in ipairs({ "LspReferenceText", "LspReferenceRead", "LspReferenceWrite" }) do
  vim.api.nvim_set_hl(0, hl, { link = "Visual" })
end

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

vim.lsp.config("pyright", {
  filetypes = { "python" },
  root_markers = { "pyproject.toml", ".git" },
})

vim.lsp.config("bashls", {
  cmd = { "bash-language-server", "start" },
  filetypes = { "sh", "bash" },
  root_markers = { ".git" },
})

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("LspConfig", { clear = true }),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)

    -- Use built-in LSP documentHighlight to highlight symbol references on cursor hold
    if client and client.server_capabilities.documentHighlightProvider then
      local group = vim.api.nvim_create_augroup("LspDocumentHighlight", { clear = false })
      vim.api.nvim_clear_autocmds({ buffer = ev.buf, group = group })
      vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
        group = group,
        buffer = ev.buf,
        callback = vim.lsp.buf.document_highlight,
      })
      vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
        group = group,
        buffer = ev.buf,
        callback = vim.lsp.buf.clear_references,
      })
    end

    local function map(mode, key, r, desc)
      vim.keymap.set(mode, key, r, { buffer = ev.buf, desc = desc })
    end
    map("n", "gd", function()
      Snacks.picker.lsp_definitions()
    end, "Goto definition")
    map("n", "gD", function()
      Snacks.picker.lsp_declarations()
    end, "Goto declaration")
    map("n", "gr", function()
      Snacks.picker.lsp_references()
    end, "Goto references")
    map("n", "gi", function()
      Snacks.picker.lsp_implementations()
    end, "Goto implementation")
    map("n", "<leader>cr", vim.lsp.buf.rename, "rename")
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
    map("n", "[[", function()
      Snacks.words.jump(-vim.v.count1)
    end, "Prev reference")
    map("n", "]]", function()
      Snacks.words.jump(vim.v.count1)
    end, "Next reference")

    map("n", "K", vim.lsp.buf.hover, "hover")
    map("n", "<leader>cd", vim.diagnostic.open_float, "Line diagnostic")
  end,
})
