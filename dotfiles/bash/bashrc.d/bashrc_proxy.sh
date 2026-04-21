#!/usr/bin/env bash

DEFAULT_PROXY_PORT=${DEFAULT_PROXY_PORT:-7890}
PROXY_HOST=${PROXY_HOST:-"127.0.0.1"}

__proxy_help_message() {
  echo "Usage: proxy {enable|on|disable|off|list|ls} [port]"
  echo
  echo "This command helps manage proxy settings by setting or unsetting related environment variables. These include both lowercase and uppercase forms (e.g., http_proxy and HTTP_PROXY)."
  echo
  echo "Arguments:"
  echo "  {--help | -h}           show this message and exit"
  echo "  {enable | on} [port]    Enables proxy settings. Optionally specify a port (default: $DEFAULT_PROXY_PORT)."
  echo "  {disable | off}         Disables all proxy settings by clearing related environment variables."
  echo "  {list | ls | status}    Lists all current proxy-related environment variables and their values."
  echo
  echo "Examples:"
  echo "  proxy                 # Enables proxy with default port $DEFAULT_PROXY_PORT."
  echo "  proxy enable          # Same as above."
  echo "  proxy on              # Same as enable."
  echo "  proxy enable 12345    # Enables proxy with port 12345."
  echo "  proxy disable         # Disables all proxy settings."
  echo "  proxy off             # Same as disable."
  echo "  proxy list            # Lists current proxy settings."
  echo "  proxy ls              # Same as list."
  echo
  echo "Environment Variables Managed:"
  echo "  - http_proxy: Lowercase HTTP proxy setting."
  echo "  - https_proxy: Lowercase HTTPS proxy setting."
  echo "  - all_proxy: Lowercase SOCKS proxy setting."
  echo "  - HTTP_PROXY: Uppercase HTTP proxy setting."
  echo "  - HTTPS_PROXY: Uppercase HTTPS proxy setting."
  echo "  - ALL_PROXY: Uppercase SOCKS proxy setting."
}

proxy() {
  local action=${1:-enable} # Default action is to enable proxy
  shift

  case "$action" in
    enable | on)
      local port=${1:-$DEFAULT_PROXY_PORT} # Default port if not provided
      # Set all common proxy environment variables (lowercase)
      export http_proxy="http://$PROXY_HOST:$port"
      export https_proxy="http://$PROXY_HOST:$port"
      export all_proxy="socks5://$PROXY_HOST:$port"
      # Set uppercase versions since some tools (including some versions/environments of Git) might read them
      export HTTP_PROXY="$http_proxy"
      export HTTPS_PROXY="$https_proxy"
      export ALL_PROXY="$all_proxy"
      echo -e "Proxy enabled (Port: $port)"
      ;;

    disable | off)
      # Unset all proxy environment variables
      unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
      echo "All proxy environment variables cleared"
      ;;

    list | ls | status)
      # List all proxy environment variables
      echo -e "Listing all current proxy environment variables:"
      echo -e "  http_proxy  = ${http_proxy:-unset}"
      echo -e "  https_proxy = ${https_proxy:-unset}"
      echo -e "  all_proxy   = ${all_proxy:-unset}"
      echo -e "  HTTP_PROXY  = ${HTTP_PROXY:-unset}"
      echo -e "  HTTPS_PROXY = ${HTTPS_PROXY:-unset}"
      echo -e "  ALL_PROXY   = ${ALL_PROXY:-unset}"
      ;;
    --help | -h)
      # print help message
      __proxy_help_message
      ;;

    *)
      # print help message and exit with error
      __proxy_help_message
      return 1
      ;;
  esac
}

_proxy() {
  local options="enable on disable off list ls status --help"
  local current_word="${COMP_WORDS[COMP_CWORD]:-}" # Ensure variable is error-safe
  COMPREPLY=($(compgen -W "${options}" -- ${current_word}))
}
complete -F _proxy proxy
