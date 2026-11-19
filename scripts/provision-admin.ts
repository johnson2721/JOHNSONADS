import "dotenv/config";
import { Secret, TOTP } from "otpauth";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { activities, authTokens, sessions, users } from "../src/db/schema";
import { hashPassword, seal, vaultReady } from "../src/lib/security";

async function main() {
  const email = (process.env.ADMIN_LOGIN_EMAIL || "johnsonkanyiri0@gmail.com").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const browserSetup = process.argv.includes("--browser-setup");
  const rotate = process.argv.includes("--rotate");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) throw new Error("Set a valid ADMIN_LOGIN_EMAIL.");
  const minimum = browserSetup ? 8 : 16;
  if (password.length < minimum || password.length > 128) throw new Error(`Provide ADMIN_PASSWORD of ${minimum}–128 characters via the process environment.`);
  if (!vaultReady()) throw new Error("Set JDE_VAULT_KEY to the output of openssl rand -hex 32.");
  const passwordHash = await hashPassword(password);
  const secret = browserSetup ? null : new Secret({ size: 20 });
  const adminSetupUntil = browserSetup ? new Date(Date.now() + 72 * 3_600_000) : null;
  const credentials = { passwordHash, mfaSecret: secret ? seal(secret.base32) : null, mfaLastCounter: 0, mustChangePassword: browserSetup, adminSetupUntil, verified: true, suspended: false };
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).for("update");
    if (existing) {
      if (existing.role !== "admin") throw new Error("This email belongs to a customer account and will not be elevated.");
      if (!rotate) throw new Error("Administrator already exists. Use --rotate to replace its password and TOTP setup.");
      await tx.update(users).set(credentials).where(eq(users.id, existing.id));
      await tx.delete(sessions).where(eq(sessions.userId, existing.id));
      await tx.delete(authTokens).where(and(eq(authTokens.userId, existing.id), eq(authTokens.kind, "admin-setup")));
      await tx.insert(activities).values({ userId: existing.id, type: "Administrator credentials rotated" });
    } else {
      const [admin] = await tx.insert(users).values({ name: "JDE Administrator", email, phone: "", country: "Kenya", category: "Other", role: "admin", ...credentials }).returning({ id: users.id });
      await tx.insert(activities).values({ userId: admin.id, type: "Administrator provisioned" });
    }
  });
  if (secret) {
    const totp = new TOTP({ issuer: "Johnson Digital Empire", label: email, algorithm: "SHA1", digits: 6, period: 30, secret });
    console.log(`Administrator ${email} is ready. Enrol this secret privately in your authenticator app now.`);
    console.log(`TOTP setup key: ${secret.base32}\nAuthenticator URI: ${totp.toString()}`);
    console.log("Use /account/login, then enter the current authenticator code. Do not email or log this setup key.");
  } else {
    console.log("Temporary administrator sign-in provisioned. Visit /admin within 72 hours to replace the temporary password and enrol an authenticator. No password or setup key was printed.");
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error && !("query" in error) ? error.message : "Database provisioning failed. Check connectivity and apply the Drizzle schema first."); process.exitCode = 1; }).finally(async () => { await pool.end(); });
