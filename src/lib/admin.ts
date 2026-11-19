import { and, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, authTokens, content, emailOutbox, expenses, inbox, listings, packages, rateBuckets, sessions, users, type User } from "@/db/schema";
import { cleanString, wholeKes } from "./marketplace";
import { processOutbox, queueCustomerMail, recordEvent, triggerMail } from "./mail";
import { reconcilePending } from "./payments";
import { AppError, canonicalOrigin, UUID } from "./security";

export async function decideListing(admin: User, id: string, raw: unknown) {
  if (!UUID.test(id)) throw new AppError(404, "Listing not found.");
  const input = z.object({ status: z.enum(["approved", "rejected", "archived"]), note: z.string().trim().max(500).default("") }).parse(raw);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.update(listings).set({ status: input.status, moderationNote: input.note, ...(input.status !== "approved" ? { promotedUntil: null } : {}), updatedAt: new Date() }).where(and(eq(listings.id, id), inArray(listings.status, ["pending", "approved", "rejected"]))).returning();
    if (!row) throw new AppError(404, "Only submitted listings can be moderated.");
    if (row.ownerId) {
      const [owner] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, row.ownerId));
      const origin = canonicalOrigin();
      if (owner) await queueCustomerMail(tx, { to: owner.email, heading: "Your listing was reviewed", fields: { Listing: row.title, Status: row.status, ...(input.note ? { Note: input.note } : {}) }, link: origin ? origin + "/dashboard?tab=listings" : undefined, label: "Manage your listings" });
      await recordEvent(tx, { userId: row.ownerId, type: `Listing ${input.status}`, reference: row.slug, detail: row.title, admin: false });
    }
    await recordEvent(tx, { actor: admin, type: `Admin: listing ${input.status}`, reference: row.slug, detail: row.title, admin: false });
    return { ok: true };
  });
  triggerMail();
  return result;
}
export async function suspendUser(admin: User, id: string, raw: unknown) {
  if (!UUID.test(id)) throw new AppError(404, "Account not found.");
  const { suspended } = z.object({ suspended: z.boolean() }).parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(users).set({ suspended }).where(and(eq(users.id, id), ne(users.role, "admin"))).returning({ id: users.id, email: users.email });
    if (!row) throw new AppError(404, "Customer account not found.");
    if (suspended) await tx.delete(sessions).where(eq(sessions.userId, row.id));
    await recordEvent(tx, { actor: admin, type: suspended ? "Account suspended" : "Account restored", reference: row.id, admin: false });
    return { ok: true };
  });
}
export async function changePlan(admin: User, slug: string, raw: unknown) {
  const input = z.object({ name: cleanString(2, 35, "Plan name"), description: cleanString(5, 150, "Description"), price: wholeKes, days: z.number().int().min(1).max(365), slots: z.number().int().min(1).max(1000), features: z.array(cleanString(3, 120, "Feature")).min(1).max(12), active: z.boolean() }).parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(packages).set(input).where(eq(packages.slug, slug)).returning({ slug: packages.slug });
    if (!row) throw new AppError(404, "Package not found.");
    await recordEvent(tx, { actor: admin, type: "Advertising package updated", reference: slug, admin: false });
    return { ok: true };
  });
}
export async function updateContent(admin: User, raw: unknown) {
  const input = z.object({ heroNote: z.string().trim().max(240), aboutNote: z.string().trim().max(800), announcement: z.string().trim().max(100) }).parse(raw);
  return db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(input)) await tx.insert(content).values({ key, value }).onConflictDoUpdate({ target: content.key, set: { value, updatedAt: new Date() } });
    await recordEvent(tx, { actor: admin, type: "Public website content updated", admin: false });
    return { ok: true };
  });
}
export async function addExpense(admin: User, raw: unknown) {
  const input = z.object({ label: cleanString(3, 150, "Expense label"), amount: wholeKes, date: z.iso.date() }).parse(raw);
  const incurredAt = new Date(`${input.date}T12:00:00+03:00`);
  if (!Number.isFinite(incurredAt.getTime()) || incurredAt > new Date(Date.now() + 86_400_000)) throw new AppError(400, "Use the date on which the expense was incurred.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(expenses).values({ label: input.label, amount: input.amount, incurredAt }).returning();
    await recordEvent(tx, { actor: admin, type: "Expense recorded", reference: row.id, admin: false });
    return { ok: true };
  });
}
export async function closeInquiry(admin: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Enquiry not found.");
  const [row] = await db.update(inbox).set({ status: "closed" }).where(eq(inbox.id, id)).returning({ id: inbox.id });
  if (!row) throw new AppError(404, "Enquiry not found.");
  await db.insert(activities).values({ userId: admin.id, type: "Enquiry closed", reference: row.id });
  return { ok: true };
}
export async function retryNotification(id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Notification not found.");
  const [row] = await db.update(emailOutbox).set({ status: "pending", attempts: 0, nextAttempt: new Date(), lastError: null }).where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, "failed"), isNull(emailOutbox.sealedLink), ne(emailOutbox.heading, "Verify your email"), ne(emailOutbox.heading, "Reset your password"))).returning({ id: emailOutbox.id });
  if (!row) throw new AppError(409, "This message cannot be retried. Security links must be requested again.");
  triggerMail();
  return { ok: true };
}
export async function jobs() {
  const started = new Date();
  const [checkedPayments] = await Promise.all([
    reconcilePending(), db.delete(rateBuckets).where(lt(rateBuckets.expiresAt, started)), db.delete(sessions).where(lt(sessions.expiresAt, started)), db.delete(authTokens).where(lt(authTokens.expiresAt, started)),
  ]);
  const mail = await processOutbox(20);
  return { checkedPayments, ...mail };
}
