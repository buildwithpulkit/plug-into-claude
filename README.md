# plug-into-claude

Plugins and mods for Claude Code

## Installing

In Claude Code, add the marketplace once:

```text
/plugin marketplace add buildwithpulkit/plug-into-claude
```

Then install any plugin from it with `/plugin install <name>@plug-into-claude`
and run `/reload-plugins`.

A plugin is code that runs inside Claude Code on your machine, with the same
access Claude Code has. Read the code first, as you would with any package.

## Plugins

| Plugin | What it does |
| --- | --- |
| [tangents](plugins/tangents) | Go off on a tangent about any paragraph of Claude's replies, kept out of the main context until you promote it |

## Adding a plugin

Put it in `plugins/<name>/` with its own `.claude-plugin/plugin.json`, then add
an entry to [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
with `"source": "./plugins/<name>"`.

## License

[MIT](LICENSE)
