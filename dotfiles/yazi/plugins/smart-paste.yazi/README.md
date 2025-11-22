# smart-paste.yazi

Paste files into the hovered directory or to the CWD if hovering over a file.

## Installation

```sh
ya pkg add yazi-rs/plugins:smart-paste
```

## Usage

Add this to your `~/.config/yazi/keymap.toml`:

```toml
[[mgr.prepend_keymap]]
on   = "p"
run  = "plugin smart-paste"
desc = "Paste into the hovered directory or CWD"
```

Note that, the keybindings above are just examples, please tune them up as needed to ensure they don't conflict with your other commands/plugins.

