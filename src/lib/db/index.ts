import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http"; // This should be drizzle-orm/neon-http
import { env } from "@/lib/config";
import * as schema from "@/db/schema";

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });
