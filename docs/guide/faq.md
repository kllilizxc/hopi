# FAQ

## General

### What is HOPI?

HOPI is a local-first, self-hosted platform for running and controlling AI coding agents (Claude Code, Codex, Gemini, OpenCode) remotely. It lets you start coding sessions on your computer and monitor/control them from your phone.

### What does HOPI stand for?

HOPI (哈皮) is a Chinese transliteration of "Happy", reflecting the project's goal of making AI coding assistance a happier experience by freeing you from the terminal.

### Is HOPI free?

Yes, HOPI is open source and free to use under the AGPL-3.0-only license.

### What AI agents does HOPI support?

- **Claude Code** (recommended)
- **OpenAI Codex**
- **Google Gemini**
- **OpenCode**

## Setup & Installation

### Do I need a hub?

HOPI includes an embedded hub. Just run `hopi hub` on your machine - no external hub required.

`hopi server` remains supported as an alias.

### How do I access HOPI from my phone?

For local network access:
```
http://<your-computer-ip>:3006
```

For internet access:
- If the hub has a public IP, access it directly (use HTTPS via reverse proxy for production)
- If behind NAT, set up a tunnel (Cloudflare Tunnel, Tailscale, or ngrok)

### What's the access token for?

The `CLI_API_TOKEN` is a shared secret that authenticates:
- CLI connections to the hub
- Web app logins
- Telegram account binding

It's auto-generated on first hub start and saved to `~/.hopi/settings.json`.

### Do you support multiple accounts?

Yes. We support lightweight multi-account access via namespaces for shared team hubs. See [Namespace (Advanced)](./namespace.md).

### Can I use HOPI without Telegram?

Yes. Telegram is optional. You can use the web app directly in any browser or install it as a PWA.

## Usage

### How do I approve permissions remotely?

1. When your AI agent requests permission (e.g., to edit a file), you'll see a notification
2. Open HOPI on your phone
3. Navigate to the active session
4. Approve or deny the pending permission

### How do I receive notifications?

HOPI supports two methods:

1. **PWA Push Notifications** - Enable when prompted, works even when app is closed
2. **Telegram Bot** - See [Telegram Setup](./installation.md#telegram-setup)

### Can I start sessions remotely?

Yes, with runner mode:

1. Run `hopi runner start` on your computer
2. Your machine appears in the "Machines" list in the web app
3. Tap to spawn new sessions from anywhere

### How do I see what files were changed?

In the session view, tap the "Files" tab to:
- Browse project files
- View git status
- See diffs of changed files

### Can I send messages to the AI from my phone?

Yes. Open any session and use the chat interface to send messages directly to the AI agent.

### Can I access a terminal remotely?

Yes. Open a session in the web app and tap the Terminal tab for a remote shell.

### How do I use voice control?

Set `ELEVENLABS_API_KEY`, open a session in the web app, and click the microphone button. See [Voice Assistant](./voice-assistant.md).

## Security

### Is my data safe?

Yes. HOPI is local-first:
- All data stays on your machine
- Nothing is uploaded to external servers
- The database is stored locally in `~/.hopi/`

### How secure is the token authentication?

The auto-generated token is 256-bit (cryptographically secure). For external access, always use HTTPS via a tunnel.

### Can others access my HOPI instance?

Only if they have your access token. For additional security:
- Use a strong, unique token
- Always use HTTPS for external access
- Consider Tailscale for private networking

## Troubleshooting

### "Connection refused" error

- Ensure hub is running: `hopi hub`
- Check firewall allows port 3006
- Verify `HOPI_API_URL` is correct

### "Invalid token" error

- Re-run `hopi auth login`
- Check token matches in CLI and hub
- Verify `~/.hopi/settings.json` has correct `cliApiToken`

### Runner won't start

```bash
# Check status
hopi runner status

# Clear stale lock file
rm ~/.hopi/runner.state.json.lock

# Check logs
hopi runner logs
```

### Claude Code not found

Install Claude Code or set custom path:
```bash
npm install -g @anthropic-ai/claude-code
# or
export HOPI_CLAUDE_PATH=/path/to/claude
```

### How do I run diagnostics?

```bash
hopi doctor
```

This checks hub connectivity, token validity, agent availability, and more.

## Comparison

### HOPI vs Happy

| Aspect | Happy | HOPI |
|--------|-------|------|
| Design | Cloud-first | Local-first |
| Users | Multi-user | Single user |
| Deployment | Multiple services | Single binary |
| Data | Encrypted on server | Never leaves your machine |

See [Why HOPI](./why-hopi.md) for detailed comparison.

### HOPI vs running Claude Code directly

| Feature | Claude Code | HOPI + Claude Code |
|---------|-------------|-------------------|
| Remote access | No | Yes |
| Mobile control | No | Yes |
| Permission approval | Terminal only | Phone/web |
| Session persistence | No | Yes |
| Multi-machine | Manual | Built-in |

## Contributing

### How can I contribute?

Visit our [GitHub repository](https://github.com/tiann/hopi) to:
- Report issues
- Submit pull requests
- Suggest features

### Where do I report bugs?

Open an issue on [GitHub Issues](https://github.com/tiann/hopi/issues).
