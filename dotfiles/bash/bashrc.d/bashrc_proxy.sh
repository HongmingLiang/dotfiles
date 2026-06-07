#!/usr/bin/env bash

DEFAULT_PROXY_PORT=${DEFAULT_PROXY_PORT:-7890}
PROXY_HOST=${PROXY_HOST:-"127.0.0.1"}

__proxy_help_message() {
  cat << EOF
Usage: proxy {enable|on|disable|off|list|ls} [port]

This command helps manage proxy settings by setting or unsetting related environment variables. These include both lowercase and uppercase forms (e.g., http_proxy and HTTP_PROXY).

Arguments:
  {--help | -h}           show this message and exit
  {enable | on} [port]    Enables proxy settings. Optionally specify a port (default: $DEFAULT_PROXY_PORT).
  {disable | off}         Disables all proxy settings by clearing related environment variables.
  {list | ls | status}    Lists all current proxy-related environment variables and their values.

Examples:
  proxy                 # Enables proxy with default port $DEFAULT_PROXY_PORT.
  proxy enable          # Same as above.
  proxy on              # Same as enable.
  proxy enable 12345    # Enables proxy with port 12345.
  proxy disable         # Disables all proxy settings.
  proxy off             # Same as disable.
  proxy list            # Lists current proxy settings.
  proxy ls              # Same as list.

Environment Variables Managed:
  - http_proxy: Lowercase HTTP proxy setting.
  - https_proxy: Lowercase HTTPS proxy setting.
  - all_proxy: Lowercase SOCKS proxy setting.
  - HTTP_PROXY: Uppercase HTTP proxy setting.
  - HTTPS_PROXY: Uppercase HTTPS proxy setting.
  - ALL_PROXY: Uppercase SOCKS proxy setting.
EOF
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
      cat << EOF
Listing all current proxy environment variables:
  http_proxy  = ${http_proxy:-unset}
  https_proxy = ${https_proxy:-unset}
  all_proxy   = ${all_proxy:-unset}
  HTTP_PROXY  = ${HTTP_PROXY:-unset}
  HTTPS_PROXY = ${HTTPS_PROXY:-unset}
  ALL_PROXY   = ${ALL_PROXY:-unset}
EOF
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
