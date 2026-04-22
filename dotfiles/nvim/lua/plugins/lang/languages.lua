-- lua/plugin/lang/languages.lua
-- Unified language configuration data source.
-- LSP names use nvim-lspconfig server names (mason-lspconfig handles mapping).
-- Formatter and linter names are direct Mason package names.

local M = {}

--- Core mapping: language name -> tool categories.
-- Supported categories:
--   lsp        : list of LSP server names (nvim-lspconfig style)
--   treesitter : list of Tree-sitter parser names
--   formatter  : list of formatter names (Mason packages)
--   linter     : list of linter names (Mason packages)
--   runner     : optional function used to build a shell command
--                for running the current file. Signature:
--                  runner(filepath: string) -> command: string
--                This is consumed by lua/config/run_current.lua,
--                which sends the command to the floating terminal.
-- Each category is optional; omit if not needed.
M.languages = {
  lua = {
    lsp = { "lua_ls" },
    treesitter = { "lua" },
    formatter = { "stylua" },
    -- linter = { "selene" },

    -- How to run the current file for this language.
    runner = function(filepath)
      return string.format("lua %s", vim.fn.fnameescape(filepath))
    end,
  },
  python = {
    lsp = { "pyright" },
    treesitter = { "python" },
    formatter = { "ruff_format" },
    linter = { "ruff" },

    -- Prefer uv when available, otherwise fall back to python3.
    runner = function(filepath)
      local escaped = vim.fn.fnameescape(filepath)
      if vim.fn.executable("uv") == 1 then
        return string.format("uv run %s", escaped)
      end
      return string.format("python3 %s", escaped)
    end,
  },
  bash = {
    lsp = { "bashls" },
    treesitter = { "bash" },
    formatter = { "shfmt" },
    -- linter = { "shellcheck" },

    runner = function(filepath)
      return string.format("bash %s", vim.fn.fnameescape(filepath))
    end,
  },
  -- Many shell scripts (like .bashrc) use the "sh" filetype in Neovim
  -- but we still want them to be formatted and parsed as bash.
  sh = {
    treesitter = { "bash" },
    formatter = { "shfmt" },

    runner = function(filepath)
      return string.format("bash %s", vim.fn.fnameescape(filepath))
    end,
  },
  markdown = {
    treesitter = { "markdown", "markdown_inline" },
    -- formatter = { "prettierd" },
  },
}

--- Generic extractor for tool lists from a given category.
-- @param field string: The category name (e.g., "lsp", "treesitter", "formatter", "linter")
-- @return table: A deduplicated list of tool names
function M.get_tools(field)
  local items = {}
  for _, config in pairs(M.languages) do
    local values = config[field]
    if values then
      -- Accept both a single string or a list
      for _, v in ipairs(vim.iter({ values }):flatten():totable()) do
        items[v] = true
      end
    end
  end
  return vim.tbl_keys(items)
end

--- Convenience wrappers (preserve familiar API for existing plugin configs)
function M.get_lsp_servers()
  return M.get_tools("lsp")
end

function M.get_treesitter_parsers()
  return M.get_tools("treesitter")
end

--- Get all tools that should be installed via Mason (LSP + formatter + linter)
function M.get_all_tools()
  local all = {}
  for _, field in ipairs({ "lsp", "formatter", "linter" }) do
    for _, tool in ipairs(M.get_tools(field)) do
      all[tool] = true
    end
  end
  return vim.tbl_keys(all)
end

--- Build filetype -> formatters mapping for conform.nvim
function M.get_formatters_by_ft()
  local map = {}
  for ft, config in pairs(M.languages) do
    if config.formatter then
      map[ft] = config.formatter
    end
  end
  return map
end

--- Build filetype -> linters mapping for nvim-lint
function M.get_linters_by_ft()
  local map = {}
  for ft, config in pairs(M.languages) do
    if config.linter then
      map[ft] = config.linter
    end
  end
  return map
end

--- Get the runner function for a given filetype, if any.
-- @param ft string
-- @return function|nil
function M.get_runner_for_ft(ft)
  local config = M.languages[ft]
  return config and config.runner or nil
end

return M
