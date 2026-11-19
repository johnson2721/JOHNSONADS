import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { authTokens, sessions, users, type User } from "@/db/schema";
import { startAdminSetup } from "./admin-activation";
import { clientUser, consumeMfa, issueAuthLink, mailVerificationReady, startSession } from "./auth";
import { cleanString, emailSchema, phoneSchema } from "./marketplace";
import { recordEvent, triggerMail } from "./mail";
import { AppError, checkPassword, hashPassword, limit, sha } from "./security";

const password = z.string().min(10, "Use at least 10 characters for your password.").max(128, "Use fewer than 129 password characters.");
const profile = z.object({ name: cleanString(2, 100, "Full name"), phone: phoneSchema, country: cleanString(2, 70, "Country"), businessName: z.string().trim().max(110).default(""), category: cleanString(2, 70, "Business category") });
const signup = profile.extend({ email: emailSchema, password, seller: z.boolean().default(false) });
const authCode = z.string().regex(/^[\w-]{43}$/, "This security link is invalid or has expired.");

export async function register(req: Request, raw: unknown) {
  const data = signup.parse(raw);
  await limit(`signup:${data.email}`, 3, 3600);
  const reserved = [process.env.ADMIN_LOGIN_EMAIL, process.env.ADMIN_NOTIFICATION_EMAIL, "johnsonkanyiri0@gmail.com"].filter(Boolean).map((email) => email!.trim().toLowerCase());
  if (reserved.includes(data.email)) throw new AppError(409, "This email cannot be used for public registration.");
  const { password: plain, seller, ...fields } = data;
  const passwordHash = await hashPassword(plain);
  const user = await db.transaction(async (tx) => {
    const [row] = await tx.insert(users).values({ ...fields, passwordHash, role: seller ? "seller" : "customer" }).onConflictDoNothing().returning();
    if (!row) throw new AppError(409, "An account already exists for this email. Log in or reset your password.");
    await recordEvent(tx, { type: "New customer registration", actor: row, detail: row.businessName || row.category, dashboard: "/admin#accounts" });
    if (seller) await recordEvent(tx, { type: "New seller registration", actor: row, detail: row.businessName || row.category, dashboard: "/admin#accounts" });
    await issueAuthLink(tx, row, "verify");
    return row;
  });
  triggerMail();
  return startSession(req, user);
}
export async function login(req: Request, raw: unknown, adminOnly = false) {
  const data = z.object({ email: emailSchema, password: z.string().min(1).max(128), code: z.string().max(12).optional() }).parse(raw);
  await limit(`login:${data.email}`, 10, 900);
  const [user] = await db.select().from(users).where(eq(users.email, data.email));
  if (!await checkPassword(data.password, user?.passwordHash) || !user || user.suspended || (adminOnly && user.role !== "admin")) throw new AppError(401, "The email or password is incorrect.");
  if (user.role === "admin" && user.mustChangePassword) return startAdminSetup(req, user);
  if (user.role === "admin" && !data.code) return Response.json({ mfaRequired: true }, { headers: { "Cache-Control": "no-store" } });
  if (user.role === "admin" && !await consumeMfa(user, data.code ?? "")) throw new AppError(401, "Enter the current code from your authenticator app.");
  return startSession(req, user);
}
export async function forgotPassword(raw: unknown) {
  const { email } = z.object({ email: emailSchema }).parse(raw);
  await limit(`reset-request:${email}`, 3, 3600);
  if (mailVerificationReady()) {
    const [user] = await db.select().from(users).where(and(eq(users.email, email), eq(users.suspended, false)));
    if (user && user.role !== "admin") {
      await db.transaction(async (tx) => { await issueAuthLink(tx, user, "reset"); await recordEvent(tx, { type: "Password reset requested", actor: user, admin: false }); });
      triggerMail();
    }
  }
  return { ok: true };
}
export async function resendVerification(user: User) {
  if (user.verified) return { ok: true };
  if (!mailVerificationReady()) throw new AppError(503, "Verification mail is not configured for this environment. Your account and drafts are still available.");
  await limit(`verify-request:${user.id}`, 3, 3600);
  await db.transaction(async (tx) => { await issueAuthLink(tx, user, "verify"); });
  triggerMail();
  return { ok: true };
}
export async function useToken(kind: "verify" | "reset", raw: unknown) {
  const parsed = z.object({ token: authCode, password: kind === "reset" ? password : z.undefined().optional() }).parse(raw);
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : undefined;
  return db.transaction(async (tx) => {
    const [known] = await tx.select({ owner: authTokens.userId }).from(authTokens).where(eq(authTokens.tokenHash, sha(parsed.token)));
    if (!known) throw new AppError(400, "This security link is invalid or has expired.");
    const [user] = await tx.select().from(users).where(eq(users.id, known.owner)).for("update");
    const [used] = await tx.delete(authTokens).where(and(eq(authTokens.tokenHash, sha(parsed.token)), eq(authTokens.kind, kind), gt(authTokens.expiresAt, new Date()))).returning();
    if (!used || !user || user.suspended || user.role === "admin") throw new AppError(400, "This security link is invalid or has expired.");
    if (kind === "reset") {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
    } else await tx.update(users).set({ verified: true }).where(eq(users.id, user.id));
    await recordEvent(tx, { type: kind === "reset" ? "Password changed" : "Email verified", actor: user, admin: false });
    return { ok: true };
  });
}
export async function updateProfile(user: User, raw: unknown) {
  const data = profile.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(users).set(data).where(eq(users.id, user.id)).returning();
    await recordEvent(tx, { type: "Profile updated", actor: user, admin: false });
    return clientUser(row);
  });
}
