/**
 * redact-row — apply the slur/hate-speech redactor to an existing message row.
 *
 * LOCAL-ONLY maintenance tool. It uses the Supabase SERVICE ROLE key (bypasses
 * RLS) to overwrite a row's `name` and `message` in place with their redacted
 * forms — the same `redact()` the Worker runs at write time. Use it to clean up
 * rows created before content filtering existed, or after adding new terms.
 *
 * Usage:
 *   npx tsx scripts/redact-row.ts <row-id>            # preview, then confirm
 *   npx tsx scripts/redact-row.ts <row-id> --dry-run  # preview only, no write
 *   npx tsx scripts/redact-row.ts <row-id> --yes      # apply without prompting
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment, then
 * from .dev.vars / .env, then (for the URL) from wrangler.jsonc. Overwriting is
 * irreversible — the original text is not kept — hence the confirmation prompt.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { redact } from "../src/lib/contentFilter";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Minimal KEY=VALUE parser for .dev.vars / .env (strips quotes and comments).
function parseEnvFile(relPath: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(REPO_ROOT + relPath, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function resolveConfig(): { url: string; serviceKey: string } {
  const devVars = parseEnvFile(".dev.vars");
  const dotEnv = parseEnvFile(".env");

  const url =
    process.env.SUPABASE_URL ||
    devVars.SUPABASE_URL ||
    dotEnv.VITE_SUPABASE_URL ||
    // Fall back to the non-secret value committed in wrangler.jsonc.
    (() => {
      try {
        const w = readFileSync(REPO_ROOT + "wrangler.jsonc", "utf8");
        return w.match(/"SUPABASE_URL"\s*:\s*"([^"]+)"/)?.[1] ?? "";
      } catch {
        return "";
      }
    })();

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    devVars.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !serviceKey) {
    console.error(
      "Missing config. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(env, .dev.vars, or wrangler.jsonc).",
    );
    process.exit(1);
  }
  return { url, serviceKey };
}

// Show the change with a caret line under the characters that were boxed out.
function preview(label: string, before: string, after: string): void {
  const changed = before !== after;
  console.log(`\n  ${label}:`);
  console.log(`    before: ${JSON.stringify(before)}`);
  console.log(
    `    after:  ${JSON.stringify(after)}${changed ? "  ← changed" : "  (unchanged)"}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipConfirm = args.includes("--yes") || args.includes("-y");
  const id = args.find((a) => !a.startsWith("-"));

  if (!id) {
    console.error(
      "Usage: npx tsx scripts/redact-row.ts <row-id> [--dry-run] [--yes]",
    );
    process.exit(1);
  }

  const { url, serviceKey } = resolveConfig();
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("messages")
    .select("id, name, message")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`No message found with id ${id}`);
    process.exit(1);
  }

  const row = data as { id: string; name: string | null; message: string | null };
  const name = row.name ?? "";
  const message = row.message ?? "";
  const safeName = redact(name);
  const safeMessage = redact(message);

  console.log(`\nMessage ${row.id}`);
  preview("name", name, safeName);
  preview("message", message, safeMessage);

  if (safeName === name && safeMessage === message) {
    console.log("\nNothing to redact — row is already clean.\n");
    return;
  }

  if (dryRun) {
    console.log("\n--dry-run: no changes written.\n");
    return;
  }

  if (!skipConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question("\nApply this redaction? This is irreversible. [y/N] ")
    )
      .trim()
      .toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("Aborted. No changes written.\n");
      return;
    }
  }

  const { error: updateError } = await supabase
    .from("messages")
    .update({ name: safeName, message: safeMessage })
    .eq("id", row.id);

  if (updateError) {
    console.error("Update failed:", updateError.message);
    process.exit(1);
  }
  console.log("\n✓ Row redacted.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
