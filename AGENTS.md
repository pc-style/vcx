The role of this file is to describe common mistakes and confusion points that agents
might encounter as they work in this project. If you ever encounter something in the
project that surprises you, please alert the developer working with you and indicate
that this is the case in this file to help prevent future agents from having the same issue.

- Bump `package.json` for every user-visible repo change and keep version-related tests in sync before committing. Use patch for same-contract fixes/docs/tests/internal changes, minor for backward-compatible new commands/flags/config/workflows, and major for breaking command/config/install behavior or changed defaults that could affect Vercel auth, passthrough, or Cloudflare mutations.
