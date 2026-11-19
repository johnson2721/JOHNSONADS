import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) throw new Error("Define DATABASE_URL in the environment or .env before using Drizzle Kit.");
export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", dbCredentials: { url: process.env.DATABASE_URL }, strict: process.env.DRIZZLE_STRICT === "1" });
