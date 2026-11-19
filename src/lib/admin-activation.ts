import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Secret } from "otpauth";
import { z } from "zod";
import { db } from "@/db";
import { authTokens, sessions, users, type User } from "@/db/schema";
import { ADMIN_SETUP_COOKIE, adminTotp, secure, startSession } from "./auth";
import { recordEvent } from "./mail";
import { AppError, checkPassword, hashPassword, limit, seal, sha, token, unseal, vaultReady } from "./security";

const setupMinutes = 12;
function allowed(user: User | undefined): user is User {
  return !!user && user.role === "admin" && user.mustChangePassword && !user.suspended && !user.mfaSecret && !!user.adminSetupUntil && user.adminSetupUntil.getTime() > Date.now();
}
export async function startAdminSetup(req: Request, user: User) {
  if (!allowed(user)) throw new AppError(403, "This administrator setup window is no longer active. Use secure administrator recovery.");
  if (!vaultReady()) throw new AppError(503, "The administrator security vault is not configured.");
  await limit(`admin-enroll:${user.id}`, 4, setupMinutes * 60);
  const raw = token(), setupKey = new Secret({ size: 20 }).base32;
  const expiresAt = new Date(Math.min(user.adminSetupUntil!.getTime(), Date.now() + setupMinutes * 60_000));
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    if (!allowed(locked) || locked.passwordHash !== user.passwordHash) throw new AppError(403, "Start sign-in again to set up your administrator account.");
    await tx.insert(authTokens).values({ userId: user.id, tokenHash: sha(raw), kind: "admin-setup", sealedPayload: seal(setupKey), expiresAt });
  });
  const response = NextResponse.json({ setupRequired: true, setupKey }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  response.cookies.set(ADMIN_SETUP_COOKIE, raw, { httpOnly: true, secure: secure(req), sameSite: "strict", path: "/api/auth", maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
  return response;
}
export async function activateAdmin(req: Request, raw: unknown) {
  const { code, password } = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the six-digit code from your authenticator."), password: z.string().min(16, "Choose a new password with at least 16 characters.").max(128, "Use fewer than 129 password characters.") }).parse(raw);
  const browserToken = (await cookies()).get(ADMIN_SETUP_COOKIE)?.value;
  if (!browserToken || !/^[\w-]{43}$/.test(browserToken)) throw new AppError(401, "Your setup has expired. Log in again to restart it.");
  const tokenHash = sha(browserToken);
  const [lookup] = await db.select({ userId: authTokens.userId }).from(authTokens).where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.kind, "admin-setup"), gt(authTokens.expiresAt, new Date())));
  if (!lookup) throw new AppError(401, "Your setup has expired. Log in again to restart it.");
  await limit(`complete-admin-enrollment:${lookup.userId}`, 12, 900);
  const user = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, lookup.userId)).for("update");
    const [setup] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.kind, "admin-setup"), gt(authTokens.expiresAt, new Date()))).for("update");
    if (!allowed(locked) || !setup?.sealedPayload) throw new AppError(401, "Your setup has expired. Log in again to restart it.");
    const timestamp = Date.now();
    const delta = adminTotp(unseal(setup.sealedPayload)).validate({ token: code, window: 1, timestamp });
    if (delta === null) throw new AppError(401, "The authenticator code did not match. Wait for a fresh code and try again.");
    if (await checkPassword(password, locked.passwordHash)) throw new AppError(400, "Choose a different password from your temporary password.");
    const passwordHash = await hashPassword(password);
    const [row] = await tx.update(users).set({ passwordHash, mustChangePassword: false, mfaSecret: setup.sealedPayload, adminSetupUntil: null, mfaLastCounter: Math.floor(timestamp / 30_000) + delta }).where(eq(users.id, locked.id)).returning();
    await tx.delete(authTokens).where(and(eq(authTokens.userId, row.id), eq(authTokens.kind, "admin-setup")));
    await tx.delete(sessions).where(eq(sessions.userId, row.id));
    await recordEvent(tx, { type: "Administrator enrolled in two-step verification", actor: row, admin: false });
    return row;
  });
  return startSession(req, user);
}
