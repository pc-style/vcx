#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vcxDir = path.join(homedir(), ".vcx");
const accountsDir = path.join(vcxDir, "accounts");
const currentAccountPath = path.join(vcxDir, "current-account");
const updateCheckPath = path.join(vcxDir, "last-update-check");
const configPath = path.join(vcxDir, "config.json");
const vercelDir = path.join(homedir(), ".vercel");
const vercelFiles = ["auth.json", "config.json"] as const;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Config = {
  vercelCommand?: string;
  autoUpdate?: { enabled?: boolean; checkIntervalHours?: number };
  cloudflare?: { tokenEnv?: string };
  domains?: Record<string, { provider?: "cloudflare" }>;
};

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
};

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
};

async function main(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }

  if (args[0] === "version" || args[0] === "v" || args[0] === "--version" || args[0] === "-v") {
    return printVersion();
  }

  if (args[0] === "update" || args[0] === "up") {
    return updateVcx();
  }

  await maybeNotifyUpdate();

  if (args[0] === "account" || args[0] === "a") {
    return handleAccount(args.slice(1));
  }

  if (args[0] === "domain" && args[1] === "add" && args[2]) {
    return handleDomainAdd(args.slice(2));
  }

  return runVercel(args, "inherit");
}

function printHelp(): void {
  console.log(`vcx - Vercel CLI extras

Usage:
  vcx [...args]                       Pass through to vercel
  vcx update | up                     Pull and rebuild vcx when installed from git
  vcx version | v | -v | --version    Print installed version and git revision
  vcx account | a add <name>          Login and save account auth
  vcx account | a remove <name>       Delete a saved account
  vcx account | a list                List saved accounts
  vcx account | a switch <name>       Activate a saved account
  vcx domain add <domain> [--dry-run] Run vercel domain add, then manage Cloudflare DNS

Config: ~/.vcx/config.json
Token:  CLOUDFLARE_API_TOKEN by default`);
}

async function printVersion(): Promise<number> {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { version?: string };
  const revision = await gitOutput(["rev-parse", "--short", "HEAD"]);
  console.log(`vcx ${packageJson.version ?? "0.0.0"}${revision ? ` (${revision})` : ""}`);
  return 0;
}

async function updateVcx(): Promise<number> {
  if (!(await exists(path.join(projectRoot, ".git")))) {
    throw new Error("vcx update requires a git-based install. Re-run the installer: curl -fsSL https://install.pcstyle.dev/vsx.sh | bash");
  }

  console.log("Updating vcx...");
  let exitCode = await runCommand("git", ["-C", projectRoot, "pull", "--ff-only"], "inherit");
  if (exitCode !== 0) return exitCode;

  exitCode = await runCommand("bun", ["install", "--cwd", projectRoot], "inherit");
  if (exitCode !== 0) return exitCode;

  exitCode = await runCommand("bun", ["run", "--cwd", projectRoot, "build"], "inherit");
  if (exitCode !== 0) return exitCode;

  await writeFile(updateCheckPath, String(Date.now()), "utf8");
  console.log("vcx is up to date.");
  return 0;
}

async function handleAccount(args: string[]): Promise<number> {
  const [command, name] = args;
  if (command === "list") return listAccounts();
  if (!name) throw new Error(`Usage: vcx account ${command ?? "<command>"} <name>`);
  validateAccountName(name);

  if (command === "add") return addAccount(name);
  if (command === "switch") return switchAccount(name, true);
  if (command === "remove") return removeAccount(name);

  throw new Error(`Unknown account command: ${command}`);
}

async function listAccounts(): Promise<number> {
  await mkdir(accountsDir, { recursive: true });
  const current = await readCurrentAccount();
  const entries = await readdir(accountsDir, { withFileTypes: true });
  const accounts = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  if (accounts.length === 0) {
    console.log("No saved accounts.");
    return 0;
  }

  for (const account of accounts) {
    console.log(`${account === current ? "*" : " "} ${account}`);
  }
  return 0;
}

async function addAccount(name: string): Promise<number> {
  const accountDir = accountPath(name);
  if (await exists(accountDir)) throw new Error(`Account already exists: ${name}`);

  await mkdir(accountDir, { recursive: true });
  const current = await readCurrentAccount();
  if (current) await saveVercelFiles(current);

  const loginExit = await runVercel(["login"], "inherit");
  if (loginExit !== 0) {
    await rm(accountDir, { recursive: true, force: true });
    return loginExit;
  }

  await saveVercelFiles(name);
  await setCurrentAccount(name);
  await runVercel(["whoami"], "inherit");
  return 0;
}

async function switchAccount(name: string, verify: boolean): Promise<number> {
  if (!(await exists(accountPath(name)))) throw new Error(`Unknown account: ${name}`);
  const current = await readCurrentAccount();
  if (current && current !== name && (await exists(accountPath(current)))) {
    await saveVercelFiles(current);
  }

  await restoreVercelFiles(name);
  await setCurrentAccount(name);
  console.log(`Switched to ${name}.`);
  return verify ? runVercel(["whoami"], "inherit") : 0;
}

async function removeAccount(name: string): Promise<number> {
  const accountDir = accountPath(name);
  if (!(await exists(accountDir))) throw new Error(`Unknown account: ${name}`);
  await rm(accountDir, { recursive: true, force: true });
  if ((await readCurrentAccount()) === name) await rm(currentAccountPath, { force: true });
  console.log(`Removed ${name}.`);
  return 0;
}

async function handleDomainAdd(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const vercelArgs = ["domain", "add", ...args.filter((arg) => arg !== "--dry-run")];
  const domain = vercelArgs[2];
  if (!domain) throw new Error("Usage: vcx domain add <domain> [--dry-run]");

  if (dryRun) {
    console.log(`[dry-run] Would run: ${(await readConfig()).vercelCommand ?? "vercel"} ${vercelArgs.join(" ")}`);
  } else {
    const vercelExit = await runVercel(vercelArgs, "inherit");
    if (vercelExit !== 0) return vercelExit;
  }

  const config = await readConfig();
  const zoneName = resolveConfiguredZone(domain, config);
  if (!zoneName) {
    console.log(`No Cloudflare zone configured for ${domain}. Add domains.<zone>.provider = "cloudflare" in ${configPath}.`);
    return 0;
  }

  await ensureCloudflareCname(domain, zoneName, config, dryRun);
  return 0;
}

async function ensureCloudflareCname(domain: string, zoneName: string, config: Config, dryRun: boolean): Promise<void> {
  const tokenEnv = config.cloudflare?.tokenEnv ?? "CLOUDFLARE_API_TOKEN";
  const token = process.env[tokenEnv];
  const record = { type: "CNAME", name: domain, content: "cname.vercel-dns.com", ttl: 1, proxied: false };

  if (dryRun) {
    console.log(`[dry-run] Would upsert Cloudflare ${record.type} ${record.name} -> ${record.content} in zone ${zoneName}.`);
    return;
  }
  if (!token) throw new Error(`Missing ${tokenEnv}.`);

  const zone = await cf<{ id: string; name: string }[]>(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`, token);
  const zoneId = zone[0]?.id;
  if (!zoneId) throw new Error(`Cloudflare zone not found: ${zoneName}`);

  const records = await cf<DnsRecord[]>(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}&type=CNAME&per_page=50`, token);
  const existing = records[0];
  if (existing) {
    await cf<DnsRecord>(`/zones/${zoneId}/dns_records/${existing.id}`, token, "PUT", record);
    console.log(`Updated Cloudflare CNAME ${domain} -> ${record.content}.`);
  } else {
    await cf<DnsRecord>(`/zones/${zoneId}/dns_records`, token, "POST", record);
    console.log(`Created Cloudflare CNAME ${domain} -> ${record.content}.`);
  }
}

async function cf<T>(pathPart: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathPart}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as CloudflareResponse<T>;
  if (!response.ok || !json.success) {
    const message = json.errors?.map((error) => error.message).filter(Boolean).join("; ") || response.statusText;
    throw new Error(`Cloudflare API failed: ${message}`);
  }
  return json.result;
}

async function maybeNotifyUpdate(): Promise<void> {
  if (process.env.VCX_NO_UPDATE_CHECK === "1") return;
  const config = await readConfig();
  if (config.autoUpdate?.enabled === false) return;
  if (!(await exists(path.join(projectRoot, ".git")))) return;

  const lastCheck = Number((await readTextIfExists(updateCheckPath)) ?? 0);
  const interval = Math.max(1, config.autoUpdate?.checkIntervalHours ?? 24) * 60 * 60 * 1000;
  if (Date.now() - lastCheck < interval) return;

  await mkdir(vcxDir, { recursive: true });
  await writeFile(updateCheckPath, String(Date.now()), "utf8");

  const fetchCode = await runCommand("git", ["-C", projectRoot, "fetch", "--quiet", "--prune"], "ignore");
  if (fetchCode !== 0) return;

  const local = await gitOutput(["rev-parse", "HEAD"]);
  const upstream = await gitOutput(["rev-parse", "@{u}"]);
  if (!local || !upstream || local === upstream) return;

  console.error("vcx update available. Run: vcx update");
}

async function runVercel(args: string[], stdio: "inherit" | "pipe"): Promise<number> {
  const command = (await readConfig()).vercelCommand ?? "vercel";
  return runCommand(command, args, stdio, `Could not find Vercel command "${command}". Install the Vercel CLI or set vercelCommand in ${configPath}.`);
}

async function runCommand(command: string, args: string[], stdio: "inherit" | "pipe" | "ignore", missingMessage?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio, shell: false });
    child.on("error", (error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        reject(new Error(missingMessage ?? `Could not find command "${command}".`));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function gitOutput(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", projectRoot, ...args], { stdio: ["ignore", "pipe", "ignore"], shell: false });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => resolve(code === 0 ? Buffer.concat(chunks).toString("utf8").trim() : undefined));
  });
}

async function saveVercelFiles(name: string): Promise<void> {
  const destination = accountPath(name);
  await mkdir(destination, { recursive: true });
  for (const file of vercelFiles) {
    const source = path.join(vercelDir, file);
    if (await exists(source)) await copyFile(source, path.join(destination, file));
  }
}

async function restoreVercelFiles(name: string): Promise<void> {
  await mkdir(vercelDir, { recursive: true });
  for (const file of vercelFiles) {
    const source = path.join(accountPath(name), file);
    const destination = path.join(vercelDir, file);
    if (await exists(source)) await copyFile(source, destination);
    else await rm(destination, { force: true });
  }
}

async function readConfig(): Promise<Config> {
  if (!(await exists(configPath))) return {};
  return JSON.parse(await readFile(configPath, "utf8")) as Config;
}

async function readTextIfExists(target: string): Promise<string | undefined> {
  if (!(await exists(target))) return undefined;
  return readFile(target, "utf8");
}

function resolveConfiguredZone(domain: string, config: Config): string | undefined {
  return Object.entries(config.domains ?? {})
    .filter(([zone, settings]) => settings.provider === "cloudflare" && (domain === zone || domain.endsWith(`.${zone}`)))
    .sort(([a], [b]) => b.length - a.length)[0]?.[0];
}

async function readCurrentAccount(): Promise<string | undefined> {
  if (!(await exists(currentAccountPath))) return undefined;
  const value = (await readFile(currentAccountPath, "utf8")).trim();
  return value || undefined;
}

async function setCurrentAccount(name: string): Promise<void> {
  await mkdir(vcxDir, { recursive: true });
  await writeFile(currentAccountPath, `${name}\n`, "utf8");
}

function accountPath(name: string): string {
  return path.join(accountsDir, name);
}

function validateAccountName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Account names may only contain letters, numbers, dots, underscores, and dashes.");
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

try {
  accessSync(process.cwd(), constants.R_OK);
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
