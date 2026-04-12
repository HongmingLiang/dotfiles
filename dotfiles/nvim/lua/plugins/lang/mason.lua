vim.pack.add({
  "https://github.com/mason-org/mason.nvim.git",
  "https://github.com/mason-org/mason-lspconfig.nvim.git",
})

local lang = require("plugins.lang.languages")

vim.defer_fn(function()
  require("mason").setup({
    ui = {
      border = "bold",
    },
  })
  vim.keymap.set({ "n" }, "<leader>cm", "<cmd>Mason<cr>", { desc = "Mason" })
  vim.keymap.set({ "n" }, "<leader>ci", "<cmd>LangInstallTools<cr>", { desc = "Install tools" })
end, 200)

vim.defer_fn(function()
  require("mason-lspconfig").setup({
    automatic_enable = true,
    ensure_installed = lang.get_lsp_servers(),
  })
end, 200)

vim.api.nvim_create_user_command("LangInstallTools", function()
  local registry = require("mason-registry")
  local tools = vim.list_extend(lang.get_tools("formatter"), lang.get_tools("linter"))
  local notify = vim.notify
  local levels = vim.log.levels

  local function ensure_tools()
    local missing = {}
    for _, name in ipairs(tools) do
      local ok, pkg = pcall(registry.get_package, name)
      if not ok or not pkg then
        notify("mason: unknown tool: " .. name, levels.WARN)
      elseif pkg:is_installed() then
        notify("mason: already installed: " .. name, levels.DEBUG)
      else
        missing[#missing + 1] = name
      end
    end

    if #missing == 0 then
      notify("mason: all configured tools already installed", levels.INFO)
      return
    end

    notify("mason: installing " .. #missing .. " tool(s)...", levels.INFO)
    for _, name in ipairs(missing) do
      local ok, pkg = pcall(registry.get_package, name)
      if ok and pkg then
        notify("mason: install -> " .. name, levels.INFO)
        pkg:install()
      end
    end
  end

  if registry.refresh then
    notify("mason: refreshing registry...", levels.DEBUG)
    registry.refresh(ensure_tools)
  else
    ensure_tools()
  end
end, { desc = "Install configured Mason tools" })
