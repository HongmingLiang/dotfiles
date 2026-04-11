vim.pack.add({
  "https://github.com/MunifTanjim/nui.nvim.git",
  "https://github.com/folke/noice.nvim.git",
})

require("noice").setup({
  presets = {
    bottom_search = true, -- use a classic bottom cmdline for search
    command_palette = false, -- position the cmdline and popupmenu together
    long_message_to_split = true, -- long messages will be sent to a split
    inc_rename = false, -- enables an input dialog for inc-rename.nvim
    lsp_doc_border = true, -- add a border to hover docs and signature help
  },
})
