# vcx

`vcx` is a small wrapper around the real Vercel CLI. Unhandled commands pass through unchanged:

```bash
vcx deploy --prod
```

Handled commands add workflow helpers:

```bash
vcx update
vcx version
vcx account add client-a
vcx account list
vcx account switch client-a
vcx account remove client-a
vcx domain add app.pcstyle.dev --dry-run
```

## Setup

One-line install:

```bash
curl -fsSL https://install.pcstyle.dev/vsx.sh | bash
```

Non-interactive install:

```bash
curl -fsSL https://install.pcstyle.dev/vsx.sh | bash -s -- --yes
```

Manual setup:

```bash
bun install
bun run build
```

For local use, link the package after building:

```bash
bun link
```

`vcx` stores account snapshots in `~/.vcx/accounts/<name>/` and swaps the Vercel CLI files in `~/.vercel/auth.json` and `~/.vercel/config.json`.

## Config

Create `~/.vcx/config.json` when you want non-default behavior:

```json
{
  "vercelCommand": "vercel",
  "cloudflare": {
    "tokenEnv": "CLOUDFLARE_API_TOKEN"
  },
  "domains": {
    "pcstyle.dev": {
      "provider": "cloudflare"
    }
  }
}
```

`vcx domain add <domain>` runs the real `vercel domain add <domain>` first. If the domain matches a configured Cloudflare zone, it upserts a DNS-only CNAME to `cname.vercel-dns.com` using the token from `CLOUDFLARE_API_TOKEN` by default.

## Updates

When installed from git using the installer, `vcx` checks for updates at most once per day during normal command runs. If `origin/main` is ahead, it prints a notice and leaves your current command alone.

Apply updates explicitly:

```bash
vcx update
```

Disable update checks in `~/.vcx/config.json`:

```json
{
  "autoUpdate": {
    "enabled": false
  }
}
```

Or for a single run:

```bash
VCX_NO_UPDATE_CHECK=1 vcx deploy --prod
```

## QoL roadmap

- Temporary account switching: `vcx --account client-a deploy --prod`.
- Import the currently logged-in Vercel account: `vcx account import <name>`.
- Show identity for every saved account: `vcx account whoami --all`.
- Snapshot/restore safety backups before every account switch.
- Interactive config bootstrap: `vcx init`.
- Domain verification: `vcx domain verify <domain>`.
- Inspect Vercel's exact DNS requirements instead of assuming the default CNAME target.
- Cloudflare conflict policy flags: `--fail-on-conflict`, `--overwrite`, `--prompt`.
- Shell completions for zsh/bash/fish.
- JSON output for scripts: `--json`.
