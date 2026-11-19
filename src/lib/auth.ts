import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TOTP, Secret } from "otpauth";
import { db } from "@/db";
import { authTokens, sessions, users, type DbTx, type User } from "@/db/schema";
import { AppError, canonicalOrigin, seal, sha, token, unseal, vaultReady } from "./security";
import { queueCustomerMail, recordEvent, smtpReady } from "./mail";

const COOKIE = "jde_session";
export const ADMIN_SETUP_COOKIE = "jde_admin_setup";
const DAY = 86_400_000;
export function mailVerificationReady() { return smtpReady() && vaultReady() && !!canonicalOrigin(); }
export function clientUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, country: user.country, businessName: user.businessName, category: user.category, role: user.role, verified: user.verified };
}
export async function currentUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
  const [row] = await db.select({ user: users, mfa: sessions.mfa }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, sha(raw)), gt(sessions.expiresAt, new Date()), eq(users.suspended, false)));
  if (!row || (row.user.role === "admin" && (!row.mfa || !row.user.mfaSecret || row.user.mustChangePassword))) return null;
  return row.user;
}
export async function requireUser(options: { admin?: boolean; verified?: boolean } = {}) {
  const user = await currentUser();
  if (!user) throw new AppError(401, "Please log in to continue.");
  if (options.admin && user.role !== "admin") throw new AppError(403, "Administrator access is required.");
  if (options.verified && !user.verified) throw new AppError(403, "Verify your email before continuing. You can resend the link from your dashboard.");
  return user;
}
export function secure(req: Request) {
  return (canonicalOrigin() ?? req.headers.get("origin"))?.startsWith("https:") || new URL(req.url).protocol === "https:";
}
export async function startSession(req: Request, user: User) {
  const raw = token(), admin = user.role === "admin";
  const maxAge = admin ? 8 * 3600 : 14 * 24 * 3600;
  const old = (await cookies()).get(COOKIE)?.value;
  await db.transaction(async (tx) => {
    if (old) await tx.delete(sessions).where(eq(sessions.tokenHash, sha(old)));
    await tx.insert(sessions).values({ tokenHash: sha(raw), userId: user.id, mfa: admin, expiresAt: new Date(Date.now() + maxAge * 1000) });
    await recordEvent(tx, { type: "Signed in", actor: user, admin: false });
  });
  const response = NextResponse.json({ user: clientUser(user) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE, raw, { httpOnly: true, sameSite: "lax", secure: secure(req), path: "/", maxAge });
  response.cookies.set(ADMIN_SETUP_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: secure(req), path: "/api/auth", maxAge: 0 });
  return response;
}
export async function endSession(req: Request) {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw) await db.delete(sessions).where(eq(sessions.tokenHash, sha(raw)));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secure(req), path: "/", maxAge: 0 });
  return response;
}
export async function issueAuthLink(tx: DbTx, user: User, kind: "verify" | "reset") {
  const origin = canonicalOrigin();
  if (!mailVerificationReady() || !origin) return false;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
  await tx.delete(authTokens).where(and(eq(authTokens.kind, kind), eq(authTokens.userId, user.id)));
  const raw = token();
  const expiresAt = new Date(Date.now() + (kind === "verify" ? DAY : 30 * 60_000));
  await tx.insert(authTokens).values({ tokenHash: sha(raw), userId: user.id, kind, expiresAt });
  await queueCustomerMail(tx, { to: user.email, heading: kind === "verify" ? "Verify your email" : "Reset your password", fields: { Name: user.name, Information: kind === "verify" ? "Confirm this address to publish listings and pay for orders. The link expires in 24 hours." : "Use this single-use link within 30 minutes. Ignore this message if you did not request a reset." }, sealedLink: seal(`${origin}/account/${kind}#token=${raw}`), label: kind === "verify" ? "Verify email address" : "Choose a new password" });
  return true;
}
export function adminTotp(secret: string) {
  return new TOTP({ issuer: "Johnson Digital Empire", label: "Administrator", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}
export async function consumeMfa(user: User, code: string) {
  if (!user.mfaSecret || !/^\d{6}$/.test(code)) return false;
  const timestamp = Date.now();
  const delta = adminTotp(unseal(user.mfaSecret)).validate({ token: code, window: 1, timestamp });
  if (delta === null) return false;
  const counter = Math.floor(timestamp / 30_000) + delta;
  const result = await db.update(users).set({ mfaLastCounter: counter }).where(and(eq(users.id, user.id), lt(users.mfaLastCounter, counter))).returning({ id: users.id });
  return result.length === 1;
}
