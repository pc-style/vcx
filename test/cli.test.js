import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = path.resolve("dist/index.js");

async function withHome(fn) {
  const home = await mkdtemp(path.join(tmpdir(), "vcx-test-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function run(args, home) {
  return execFileAsync(process.execPath, [cli, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

test("prints help", async () => {
  await withHome(async (home) => {
    const { stdout } = await run(["--help"], home);
    assert.match(stdout, /vcx - Vercel CLI extras/);
    assert.match(stdout, /vcx account switch <name>/);
  });
});

test("lists empty account store", async () => {
  await withHome(async (home) => {
    const { stdout } = await run(["account", "list"], home);
    assert.equal(stdout.trim(), "No saved accounts.");
  });
});

test("switches and removes saved account snapshots", async () => {
  await withHome(async (home) => {
    const vcx = path.join(home, ".vcx");
    const account = path.join(vcx, "accounts", "client-a");
    await mkdir(account, { recursive: true });
    await writeFile(path.join(account, "auth.json"), '{"token":"saved"}\n');
    await writeFile(path.join(account, "config.json"), '{"scope":"saved"}\n');
    await writeFile(path.join(vcx, "config.json"), JSON.stringify({ vercelCommand: "/usr/bin/true" }));

    const switched = await run(["account", "switch", "client-a"], home);
    assert.match(switched.stdout, /Switched to client-a/);
    assert.equal(await readFile(path.join(home, ".vercel", "auth.json"), "utf8"), '{"token":"saved"}\n');
    assert.equal(await readFile(path.join(vcx, "current-account"), "utf8"), "client-a\n");

    const listed = await run(["account", "list"], home);
    assert.match(listed.stdout, /\* client-a/);

    const removed = await run(["account", "remove", "client-a"], home);
    assert.match(removed.stdout, /Removed client-a/);
  });
});

test("domain add dry-run does not call Vercel or Cloudflare", async () => {
  await withHome(async (home) => {
    await mkdir(path.join(home, ".vcx"), { recursive: true });
    await writeFile(
      path.join(home, ".vcx", "config.json"),
      JSON.stringify({
        vercelCommand: "/path/that/must/not/run",
        domains: { "pcstyle.dev": { provider: "cloudflare" } },
      }),
    );

    const { stdout } = await run(["domain", "add", "app.pcstyle.dev", "--dry-run"], home);
    assert.match(stdout, /Would run: \/path\/that\/must_not_run|Would run: \/path\/that\/must\/not\/run/);
    assert.match(stdout, /Would upsert Cloudflare CNAME app\.pcstyle\.dev -> cname\.vercel-dns\.com/);
  });
});

test("passthrough reports a helpful error when vercel is missing", async () => {
  await withHome(async (home) => {
    await mkdir(path.join(home, ".vcx"), { recursive: true });
    await writeFile(path.join(home, ".vcx", "config.json"), JSON.stringify({ vercelCommand: "/definitely/missing/vercel" }));

    await assert.rejects(
      run(["whoami"], home),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Could not find Vercel command/);
        return true;
      },
    );
  });
});
