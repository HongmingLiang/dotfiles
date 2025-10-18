set nocompatible
set laststatus=2 " Always show status line

set encoding=utf8 nobomb
syntax on " Enable syntax highlighting
set number " Show line numbers
set cursorline " Highlight current line
set ruler " Show cursor position
set showmode " Show current mode
set showcmd " Show command in status line

set autoindent " Enable auto indentation"
set tabstop=4
set shiftwidth=4
set expandtab " Use spaces instead of tabs
set wildmenu " Enhanced command line completion

" Enable search settings
set incsearch " Incremental search
set ignorecase " Ignore case in search patterns
set smartcase " Override ignorecase if search pattern contains uppercase letters
set hlsearch " Highlight search results

set mouse=a " Enable mouse support

let mapleader=";"
map <F1> :help<CR>
nnoremap <leader>w :w<CR>
nnoremap <leader>q :q<CR>
nnoremap <leader>wq :wq<CR>
nnoremap <leader>r :source ~/.vimrc<CR>
nnoremap <leader>n :set number!<CR>
nnoremap <leader><space> :nohlsearch<CR>