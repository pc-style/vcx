# vcx Plan

A small QoL wrapper around the Vercel CLI that keeps using the real/updatable `vercel` command while adding missing workflow helpers.

## Location

```txt
~/projects/03-CLI-Tools/vcx/
```

## Goal

Build a Node/TypeScript CLI, likely named `vcx`, that forwards normal commands to Vercel CLI but intercepts selected commands for extra behavior.

Examples:

```bash
vcx deploy --prod
vcx account add client-a
vcx account switch client-b
vcx domain add app.pcstyle.dev
```

## Core Principle

Do **not** reimplement Vercel CLI.

Use the actual installed/latest Vercel CLI underneath so updates keep working:

```bash
vercel ...
# or configurable later:
npx vercel@latest ...
pnpm dlx vercel@latest ...
```

Unknown/unhandled commands should pass through unchanged.

## Feature 1: Multi-account Vercel auth

Problem: Vercel CLI auth is effectively one active account at a time, but client work needs many accounts without juggling browser profiles.

Desired commands:

```bash
vcx account add <name>
vcx account remove <name>
vcx account list
vcx account switch <name>
```

Possible storage:

```txt
~/.vcx/
  config.json
  current-account
  accounts/
    client-a/
      auth.json
      config.json
    client-b/
      auth.json
      config.json
```

Vercel files to investigate/confirm:

```txt
~/.vercel/auth.json
~/.vercel/config.json
```

### `vcx account add <name>` flow

1. Check whether account name already exists.
2. Preserve current Vercel auth/config if present.
3. Run real `vercel login`.
4. Save resulting Vercel auth/config into `~/.vcx/accounts/<name>/`.
5. Decide whether to leave new account active or restore previous active account. Initial default can be: leave the new account active.
6. Store/update `~/.vcx/current-account`.
7. Optionally run `vercel whoami` to verify.

### `vcx account switch <name>` flow

1. If current account is known, save current `~/.vercel/*` auth files back into that named account.
2. Copy selected account files from `~/.vcx/accounts/<name>/` into `~/.vercel/`.
3. Update `~/.vcx/current-account`.
4. Run `vercel whoami` and show active account.

### Later QoL

Temporary per-command account switching:

```bash
vcx --account client-a deploy --prod
vcx -a client-a domain add app.pcstyle.dev
```

Flow:

1. Save active account.
2. Switch to requested account.
3. Run forwarded/intercepted command.
4. Restore previous account.

## Feature 2: Cloudflare DNS automation for `vercel domain add`

Problem: Vercel removed/changed one-click Cloudflare DNS integration. Need to keep using Cloudflare for DNS/R2/etc but auto-create required Vercel records.

Desired command:

```bash
vcx domain add <subdomain>.pcstyle.dev
```

Behavior:

1. Detect/intercept `domain add`.
2. Run real Vercel CLI command:

   ```bash
   vercel domain add <domain>
   ```

3. Determine required DNS records.
   - First implementation could parse Vercel CLI output if stable enough.
   - Better implementation may call Vercel API to inspect domain/configuration.
4. Detect Cloudflare zone, e.g. `pcstyle.dev`.
5. Add/update required Cloudflare DNS records using a token with DNS write permission.
6. Optionally verify with Vercel CLI/API afterward.

### Cloudflare config

Prefer environment variable for the token initially:

```bash
export CLOUDFLARE_API_TOKEN=...
```

Possible config shape:

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

Avoid storing tokens directly unless adding macOS Keychain support.

## Suggested implementation stack

- TypeScript
- Node CLI package
- `tsx` or compiled `dist` binary
- CLI parser: `commander`, `cac`, or `clipanion`
- Process execution: `execa`
- File paths: `env-paths` or simple explicit `~/.vcx`
- Config validation: `zod` if useful

Per project preference: when adding packages, use package manager install commands rather than manually editing `package.json`.

## Initial milestones

### Milestone 1: Project skeleton

- Initialize package.
- Add TypeScript.
- Add CLI entrypoint.
- Add lint/check/format scripts.
- Implement default passthrough:

  ```bash
  vcx [...args] -> vercel [...args]
  ```

### Milestone 2: Account storage

- Implement path helpers.
- Implement backup/copy logic for Vercel auth files.
- Implement:

  ```bash
  vcx account list
  vcx account switch <name>
  ```

### Milestone 3: Account add/remove

- Implement:

  ```bash
  vcx account add <name>
  vcx account remove <name>
  ```

- Confirm exact Vercel auth file behavior on this machine.

### Milestone 4: Domain interception

- Intercept:

  ```bash
  vcx domain add <domain>
  ```

- Run real Vercel command.
- Capture output.
- Decide whether CLI output parsing is sufficient or Vercel API is needed.

### Milestone 5: Cloudflare integration

- Resolve Cloudflare zone for domain.
- Create/update DNS records.
- Add dry-run mode if useful:

  ```bash
  vcx domain add app.pcstyle.dev --dry-run
  ```

## Open decisions

- Final CLI name: `vcx` for now.
- Should account add leave the new account active, or restore previous active account?
- Should Cloudflare token be env-only at first, or use macOS Keychain?
- Should `vcx domain add` automatically overwrite conflicting DNS records, prompt, or fail?
- Should default Vercel command be `vercel`, `npx vercel@latest`, or configurable from day one?
