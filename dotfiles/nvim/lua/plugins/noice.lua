vim.pack.add({
  "https://github.com/MunifTanjim/nui.nvim.git",
  "https://github.com/folke/noice.nvim.git",
})

require("noice").setup({
  lsp = {
    override = {
      ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
      ["vim.lsp.util.stylize_markdown"] = true,
      ["cmp.entry.get_documentation"] = true,
    },
  },
  routes = {
    {
      view = "mini",
      filter = {
        event = "msg_show",
        any = {
          { find = "%d+L, %d+B" },
          { find = "; after #%d+" },
          { find = "; before #%d+" },
          { find = "written" },
          { find = "%[w%]" },
        },
      },
      opts = { replace = false, merge = false, skip = false },
    },
  },
  presets = {
    bottom_search = true, -- use a classic bottom cmdline for search
    command_palette = false, -- position the cmdline and popupmenu together
    long_message_to_split = true, -- long messages will be sent to a split
    inc_rename = false, -- enables an input dialog for inc-rename.nvim
    lsp_doc_border = true, -- add a border to hover docs and signature help
  },
})

local map = vim.keymap.set

map({ "i", "n", "s" }, "<c-u>", function()
  if not require("noice.lsp").scroll(-8) then
    return "<c-u>"
  end
end, { silent = true, expr = true, desc = "Scroll backward" })

map({ "i", "n", "s" }, "<c-d>", function()
  if not require("noice.lsp").scroll(8) then
    return "<c-d>"
  end
end, { silent = true, expr = true, desc = "Scroll forward" })
