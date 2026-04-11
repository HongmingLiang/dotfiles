vim.pack.add({ "https://github.com/lewis6991/gitsigns.nvim.git" })

require("gitsigns").setup({
  on_attach = function(buffer)
    local gs = require("gitsigns")

    local function map(mode, key, r, desc)
      vim.keymap.set(mode, key, r, { buffer = buffer, silent = true, desc = desc })
    end

    -- Navigation
    map("n", "]h", function()
      if vim.wo.diff then
        vim.cmd.normal({ "]c", bang = true })
      else
        gs.nav_hunk("next")
      end
    end, "Prev hunk")
    map("n", "[h", function()
      if vim.wo.diff then
        vim.cmd.normal({ "[c", bang = true })
      else
        gs.nav_hunk("prev")
      end
    end, "Next hunk")
    map("n", "]H", function()
      gs.nav_hunk("last")
    end, "Last Hunk")
    map("n", "[H", function()
      gs.nav_hunk("first")
    end, "First Hunk")

    map("n", "<leader>ghp", gs.preview_hunk, "Preview Hunk")
    map("n", "<leader>ghi", gs.preview_hunk_inline, "Preview Hunk Inline")
    map("n", "<leader>gl", function()
      gs.blame_line({ full = true })
    end, "Blame line")
  end,
})
