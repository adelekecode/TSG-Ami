import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
const directory = ".wrangler/backups";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const target = directory + "/ami-db-pre-v7-migration-20261024.sql";
const result = spawnSync(
  "node_modules/.bin/wrangler",
  ["d1", "export", "ami-db", "--remote", "--output", target],
  { encoding: "utf8" },
);
// Wrangler prints an expiring signed download URL; redact it before any output.
for (const text of [result.stdout, result.stderr])
  if (text)
    process.stdout.write(
      text.replace(/https:\/\/\S+/g, "[temporary export URL redacted]"),
    );
if (result.status === 0) chmodSync(target, 0o600);
process.exitCode = result.status ?? 1;
