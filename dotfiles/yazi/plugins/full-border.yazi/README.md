## Installation

```sh
ya pkg add yazi-rs/plugins:full-border
```

## Usage

Add this to your `init.lua` to enable the plugin:

```lua
require("full-border"):setup()
```

Or you can customize the border type:

```lua
require("full-border"):setup {
	-- Available values: ui.Border.PLAIN, ui.Border.ROUNDED
	type = ui.Border.ROUNDED,
}
```
