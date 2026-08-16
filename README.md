# vcx

`vcx` is an experimental, unofficial wrapper around the installed [Vercel CLI](https://vercel.com/docs/cli). It addresses two local workflow gaps: switching between saved Vercel CLI accounts and optionally adding a Cloudflare DNS record after `vercel domain add`. Commands that `vcx` does not handle are passed to `vercel` unchanged.

> **Status:** Experimental and pre-1.0. There are no releases or compatibility guarantees. Review the [trust and privacy notes](#trust-and-privacy) before using real credentials or changing DNS.

## Demo

Normal Vercel commands pass through:

```bash
vcx deploy --prod
```

With a [configured Cloudflare zone](#configure-cloudflare-dns), the built-in dry run shows the Vercel and Cloudflare operations without performing them:

```bash
vcx domain add app.example.com --dry-run
```

Account and utility commands:

```bash
vcx account add client-a       # alias: vcx a add client-a
vcx account list               # alias: vcx a list
vcx account switch client-a    # alias: vcx a switch client-a
vcx account remove client-a    # alias: vcx a remove client-a
vcx update                     # alias: vcx up
vcx version                    # aliases: vcx v, vcx -v, vcx --version
```

There is no hosted application demo; `vcx` is a local CLI.

## Install

Requirements: macOS or Linux, Git, Bun, Node.js 18 or newer, an installed Vercel CLI, and `~/.local/bin` on `PATH` (or a custom `VCX_BIN_DIR`). Cloudflare automation additionally requires an API token with DNS edit access to the intended zone.

Inspect and run the installer:

```bash
curl -fsSL https://install.pcstyle.dev/vsx.sh -o /tmp/vcx-install.sh
less /tmp/vcx-install.sh
bash /tmp/vcx-install.sh
```

For a non-interactive install, pass `--yes`:

```bash
bash /tmp/vcx-install.sh --yes
```

Or build the source directly:

```bash
git clone https://github.com/pc-style/vcx.git
cd vcx
bun install
bun run build
bun link
```

The installer clones this repository, installs its development dependencies, builds `dist/index.js`, and symlinks it into `~/.local/bin` by default. It does not install the Vercel CLI.

## Configure Cloudflare DNS

Create `~/.vcx/config.json` when you want non-default behavior:

```json
{
  "vercelCommand": "vercel",
  "cloudflare": {
    "tokenEnv": "CLOUDFLARE_API_TOKEN"
  },
  "domains": {
    "example.com": {
      "provider": "cloudflare"
    }
  }
}
```

Then provide the token through the configured environment variable:

```bash
export CLOUDFLARE_API_TOKEN="..."
vcx domain add app.example.com --dry-run
```

Without `--dry-run`, `vcx domain add <domain>` first runs the real `vercel domain add <domain>`. For a matching configured Cloudflare zone, it then creates or updates a DNS-only CNAME at that exact name pointing to `cname.vercel-dns.com`. Confirm that this record is appropriate for the domain before running the command; `vcx` does not inspect Vercel for a domain-specific DNS requirement.

## Trust and privacy

- `vcx` runs locally and no project-specific telemetry is implemented. Passthrough commands and account verification invoke the configured Vercel CLI, and DNS automation calls the Cloudflare API.
- Account snapshots include Vercel's `auth.json` and `config.json`. They are copied unencrypted between `~/.vercel/` and `~/.vcx/accounts/<name>/`; protect those directories as credentials. `account remove` permanently removes the named snapshot.
- The Cloudflare token is read from an environment variable and sent as a bearer token to `api.cloudflare.com`. `vcx` stores the environment variable's name in config, not the token itself.
- Git-based installs check their configured Git remote for updates at most once per day unless disabled. The check writes a timestamp to `~/.vcx/last-update-check`; updates are only applied by `vcx update`.
- The install endpoint serves this repository's `install.sh`. Piping remote scripts directly into a shell skips the review step, so the install instructions above download it first.
- This repository has automated tests for local CLI behavior, but they do not authenticate to Vercel or Cloudflare and do not prove production safety.

Disable update checks globally:

```json
{
  "autoUpdate": {
    "enabled": false
  }
}
```

Or disable one check:

```bash
VCX_NO_UPDATE_CHECK=1 vcx deploy --prod
```

## Development

```bash
bun install
bun run check
bun run test
```

The current implementation and planned ideas are tracked in [`PLAN.md`](PLAN.md). No maintenance schedule or support commitment is currently published.

## License

No license is granted. The source is publicly visible, but it is not currently offered under an open-source license. See [`LICENSE`](LICENSE).

## Provenance

The canonical source is [`pc-style/vcx`](https://github.com/pc-style/vcx). The project wraps the independently installed Vercel CLI and optionally calls Cloudflare's API; it is not an official Vercel or Cloudflare project. Vercel and Cloudflare names belong to their respective owners.
