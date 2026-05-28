# Quick Start

<Steps>

## Install HOPI

::: code-group

```bash [npm]
npm install -g @twsxtd/hopi
```

```bash [Homebrew]
brew install tiann/tap/hopi
```

```bash [npx (one-off)]
npx @twsxtd/hopi
```

:::

Other install options: [Installation](./installation.md)

## Start the hub

```bash
hopi hub --relay
```

On first run, HOPI prints an access token and saves it to `~/.hopi/settings.json`.

`hopi server` remains supported as an alias.

The terminal will display a URL and QR code for remote access.

> End-to-end encrypted with WireGuard + TLS.

## Start a coding session

```bash
hopi
```

This starts Claude Code wrapped with HOPI. The session appears in the web UI.

## Open the UI

Open the URL shown in the terminal, or scan the QR code with your phone.

Enter your access token to log in.

</Steps>

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HOPI from anywhere
- [Notifications](./installation.md#telegram-setup) - Set up Telegram notifications
- [Install the App](./pwa.md) - Add HOPI to your home screen
