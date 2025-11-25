
# set PATH so it includes user's private bin if it exists
[ -d "$HOME/bin" ] && PATH="$HOME/bin:$PATH"
[ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH"

# if running bash
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

case "$-" in
    *i*)
        if command -v fastfetch > /dev/null 2>&1; then
            fastfetch
        else
            echo -e "\033[1;34mWelcome, $USER! $(date +"%Y-%m-%d %H:%M:%S")\033[0m"
        fi
        ;;
esac

