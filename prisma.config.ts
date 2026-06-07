// Prisma CLI configuration (Prisma 7+).
//
// As of Prisma 7, CLI config lives here (not in package.json), .env files are
// no longer auto-loaded, and `datasource.directUrl` is gone — the migration
// engine uses `datasource.url` directly. Migrations need a DIRECT connection
// (Postgres port 5432, NOT the Supavisor pooler), so we point `url` at
// DIRECT_URL. We never generate Prisma Client, so there's no generator config.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Direct connection (port 5432). The pooled DATABASE_URL is not used by
    // Prisma — runtime queries go through supabase-js, not Prisma Client.
    url: env("DIRECT_URL"),
  },
});
