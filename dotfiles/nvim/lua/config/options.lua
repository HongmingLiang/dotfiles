-- lua/config/options.lua

local opt = vim.opt

opt.termguicolors = true -- True color support
opt.mouse = "a" -- Enable mouse mode
opt.spelllang = { "en" }
opt.timeoutlen = vim.g.vscode and 1000 or 300
opt.errorbells = false
opt.encoding = "utf-8"
opt.clipboard:append("unnamedplus")
opt.path:append("**") -- include all the subdirs
opt.wildmenu = true
opt.wildmode = "longest:full,full" -- Command-line completion mode

-- files
opt.autoread = true
opt.confirm = true -- Confirm to save changes before exiting modified buffer
opt.undofile = true
opt.undolevels = 1000
opt.updatetime = 200 -- Save swap file and trigger CursorHold
opt.backup = false
opt.swapfile = false
opt.writebackup = false

-- editor
opt.expandtab = true -- Use spaces instead of tabs
opt.tabstop = 2 -- Number of spaces tabs count for
opt.shiftwidth = 2 -- Size of an indent
opt.smartindent = true -- Insert indents automatically
opt.softtabstop = 2
opt.shiftround = true
opt.virtualedit = "block"
opt.completeopt = "menu,menuone,noselect"
opt.backspace = "indent,eol,start"

-- UI
opt.cursorline = true -- Enable highlighting of the current line
opt.number = true -- Print line number
opt.relativenumber = true -- Relative line numbers
opt.signcolumn = "yes"
opt.selection = "inclusive"

opt.splitbelow = true -- Put new windows below current
opt.splitkeep = "screen"
opt.splitright = true -- Put new windows right of current
opt.winminwidth = 5

opt.wrap = false
opt.linebreak = true
opt.list = true

opt.foldlevel = 99
opt.foldmethod = "indent"
opt.conceallevel = 2

opt.scrolloff = 10
opt.sidescrolloff = 10
opt.smoothscroll = true

opt.pumblend = 10 -- Popup blend
opt.pumheight = 10 -- Maximum number of entries in a popup

opt.fillchars = {
  foldopen = "",
  foldclose = "",
  fold = " ",
  foldsep = " ",
  diff = "╱",
  eob = " ",
}

-- search
opt.smartcase = true -- Don't ignore case with capitals
opt.ignorecase = true -- Ignore case
opt.hlsearch = true
opt.incsearch = true
opt.grepformat = "%f:%l:%c:%m"
opt.grepprg = "rg --vimgrep"
