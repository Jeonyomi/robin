import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const offlineCommands = new Set(["generate", "check", "up"]);
const isOfflineCommand = process.argv.some((arg) => offlineCommands.has(arg));

if (!databaseUrl && !isOfflineCommand) {
  throw new Error(
    "DATABASE_URL_UNPOOLED or DATABASE_URL is required for Drizzle database commands.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations-postgres",
  dbCredentials: {
    // Offline schema commands only read local files; database commands fail closed above.
    url: databaseUrl ?? "postgresql://generate-only.invalid/robin",
  },
  strict: true,
  verbose: true,
});
