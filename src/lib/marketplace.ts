import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, assets, bookmarks, inbox, listings, orders, packages, payments, refunds, subscriptions, users, type DbTx, type Listing, type User } from "@/db/schema";
import { KINDS, LISTING_ACTIVITY, SERVICES, money } from "./catalog";
import { card, getListing, initializeCatalog, publicCondition } from "./public-data";
import { queueCustomerMail, recordEvent, triggerMail } from "./mail";
import { AppError, canonicalOrigin, hitRate, UUID } from "./security";

export const cleanString = (min: number, max: number, field: string) => z.string({ error: `${field} is required.` }).trim().min(min, `${field} is too short.`).max(max, `${field} is too long.`);
export const emailSchema = z.string().trim().toLowerCase().max(180).pipe(z.email({ error: "Enter a valid email address." }));
export const phoneSchema = z.string().trim().max(30).refine((p) => /^\+?[\d ()-]{7,25}$/.test(p) && p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15, "Enter a valid phone number.");
export const wholeKes = z.number().int().min(1, "Enter a positive amount.").max(500_000_000, "This amount is too high.");
const listingInput = z.object({
  title: cleanString(4, 100, "Title"), kind: z.enum(KINDS as [typeof KINDS[number], ...typeof KINDS]), category: cleanString(2, 60, "Category"),
  description: cleanString(15, 5000, "Description"), location: cleanString(2, 90, "Location"), price: wholeKes.nullable().optional(),
  priceUnit: z.enum(["", "/ month", "/ day", "/ hour", "/ project"]).default(""), photoIds: z.array(z.uuid()).max(5).default([]), submit: z.boolean().default(false),
}).superRefine((data, ctx) => { if (data.kind === "products" && !data.price) ctx.addIssue({ code: "custom", message: "Enter a price for your product." }); });

const newSlug = (title: string) => (title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "listing") + "-" + randomUUID().slice(0, 8);
export const orderRef = () => `JDE-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
export const mediaPath = (id: string) => `/api/media/${id}`;
export async function lockUser(tx: DbTx, id: string) { await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update"); }

export async function writeListing(user: User, data: unknown, id?: string) {
  const input = listingInput.parse(data);
  if (input.submit && !user.verified) throw new AppError(403, "Verify your email before submitting a listing. You can save a draft now.");
  if (id && !UUID.test(id)) throw new AppError(404, "Listing not found.");
  const photos = [...new Set(input.photoIds)];
  if (photos.length) {
    const available = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.ownerId, user.id), inArray(assets.id, photos)));
    if (available.length !== photos.length) throw new AppError(400, "Upload your own listing photos before saving.");
  }
  const newListing = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const update = { title: input.title, kind: input.kind, category: input.category, description: input.description, location: input.location, price: input.price ?? null, priceUnit: input.priceUnit, images: photos.map(mediaPath), status: input.submit ? "pending" as const : "draft" as const, moderationNote: "", updatedAt: new Date() };
    let row: Listing;
    if (id) {
      const [existing] = await tx.select().from(listings).where(and(eq(listings.id, id), eq(listings.ownerId, user.id))).for("update");
      if (!existing || existing.status === "archived") throw new AppError(404, "Listing not found.");
      [row] = await tx.update(listings).set(update).where(eq(listings.id, id)).returning();
    } else {
      [row] = await tx.insert(listings).values({ ...update, ownerId: user.id, slug: newSlug(input.title) }).returning();
    }
    if (input.submit) {
      const changed = await tx.update(users).set({ role: "seller" }).where(and(eq(users.id, user.id), eq(users.role, "customer"))).returning({ id: users.id });
      if (changed.length) await recordEvent(tx, { type: "New seller registration", actor: user, detail: user.businessName || input.category });
    }
    await recordEvent(tx, { type: input.submit ? LISTING_ACTIVITY[input.kind] : "Listing draft saved", actor: user, reference: row.slug, detail: row.title, admin: input.submit, dashboard: "/admin#listings" });
    return row;
  });
  if (input.submit) triggerMail();
  return newListing;
}
export async function archiveListing(user: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Listing not found.");
  return db.transaction(async (tx) => {
    const [row] = await tx.update(listings).set({ status: "archived", promotedUntil: null, updatedAt: new Date() }).where(and(eq(listings.id, id), eq(listings.ownerId, user.id))).returning();
    if (!row) throw new AppError(404, "Listing not found.");
    await recordEvent(tx, { type: "Listing removed", actor: user, detail: row.title, reference: row.slug, admin: false });
    return { ok: true };
  });
}
export async function promoteListing(user: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Listing not found.");
  return db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const [row] = await tx.select().from(listings).where(and(eq(listings.id, id), eq(listings.ownerId, user.id), eq(listings.status, "approved"))).for("update");
    if (!row) throw new AppError(404, "Only approved listings can be promoted.");
    const now = new Date();
    const [plan] = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), gt(subscriptions.endsAt, now))).orderBy(desc(subscriptions.slots), desc(subscriptions.endsAt)).limit(1);
    if (!plan) throw new AppError(409, "Purchase an advertising package before promoting a listing.");
    const [live] = await tx.select({ count: sql<number>`count(*)::int` }).from(listings).where(and(eq(listings.ownerId, user.id), gt(listings.promotedUntil, now), eq(listings.status, "approved"), sql`${listings.id} <> ${id}`));
    if (live.count >= plan.slots) throw new AppError(409, "Your package’s featured slots are in use.");
    await tx.update(listings).set({ promotedUntil: plan.endsAt }).where(eq(listings.id, row.id));
    await recordEvent(tx, { type: "Listing promoted", actor: user, reference: row.slug, detail: row.title, admin: false });
    return { ok: true, until: plan.endsAt };
  });
}

export function protectMessage(text: string) {
  if (/(?:\b(?:pin|otp|cvv|cvc|one[- ]time (?:code|password)|bank(?:ing)? password)\s*(?:is|=|:)\s*\S+)|(?:\b\d[ -]?(?:\d[ -]?){12,18}\b)/i.test(text)) throw new AppError(400, "Remove the payment or authentication details from your message before submitting it.");
}
const inquiryInput = z.object({ kind: z.enum(["contact", "support", "business", "partnership", "complaint", "service", "enquiry"]), name: cleanString(2, 100, "Name").optional(), email: emailSchema.optional(), phone: z.union([phoneSchema, z.literal("")]).optional(), subject: cleanString(3, 140, "Subject"), message: cleanString(10, 4000, "Message"), listingSlug: z.string().max(140).optional(), service: z.string().max(70).optional(), website: z.string().max(100).optional() });
const inquiryEvents = { contact: "Contact form submission", support: "Customer support request", business: "New business enquiry", partnership: "Business partnership request", complaint: "Customer complaint", service: "New service request", enquiry: "New customer enquiry" } as const;
export async function writeInquiry(user: User | null, raw: unknown) {
  const input = inquiryInput.parse(raw);
  protectMessage(`${input.subject}\n${input.message}`);
  if (input.website) throw new AppError(400, "This submission cannot be accepted.");
  if (!user && (!input.name || !input.email)) throw new AppError(400, "Enter your name and email address.");
  const item = input.listingSlug ? await getListing(input.listingSlug) : null;
  const listing = item?.listing;
  if (input.kind === "enquiry" && ((!listing?.ownerId && !listing?.managedCategory) || listing?.example)) throw new AppError(404, "This example does not accept seller enquiries.");
  if (listing?.ownerId && user?.id === listing.ownerId) throw new AppError(400, "You cannot enquire about your own listing.");
  const service = SERVICES.find((s) => s.slug === input.service);
  const [subject, recipient] = [service ? service.name : input.subject, input.kind === "enquiry" ? listing?.ownerId : null];
  const name = user?.name || input.name!, email = user?.email || input.email!, phone = user?.phone || input.phone || "";
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(inbox).values({ kind: input.kind, userId: user?.id, listingId: listing?.id, recipientId: recipient, name, email, phone, subject, message: input.message }).returning();
    await recordEvent(tx, { type: inquiryEvents[input.kind], actor: { id: user?.id, name, email, phone }, reference: created.id, detail: listing?.title ?? subject, dashboard: "/admin#inbox" });
    if (recipient) {
      const [seller] = await tx.select({ email: users.email, verified: users.verified }).from(users).where(and(eq(users.id, recipient), eq(users.suspended, false)));
      const origin = canonicalOrigin();
      if (seller?.verified) await queueCustomerMail(tx, { to: seller.email, heading: "You have a marketplace enquiry", fields: { Listing: listing?.title ?? subject, Reference: created.id }, link: origin ? origin + "/dashboard?tab=inbox" : undefined, label: "Open your inbox" });
    }
    return created;
  });
  triggerMail();
  return { reference: row.id };
}
export async function replyInquiry(user: User, id: string, raw: unknown) {
  if (!UUID.test(id)) throw new AppError(404, "Enquiry not found.");
  const input = z.object({ response: cleanString(3, 4000, "Reply"), quote: wholeKes.optional() }).parse(raw);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(inbox).where(eq(inbox.id, id)).for("update");
    if (!row || (user.role !== "admin" && row.recipientId !== user.id)) throw new AppError(404, "Enquiry not found.");
    if (row.status === "closed") throw new AppError(409, "This enquiry is closed.");
    let reference = id, orderId: string | null = null;
    if (input.quote && (row.kind !== "service" || user.role !== "admin")) throw new AppError(403, "Quotes are only available for professional service requests.");
    if (input.quote && row.userId) {
      const [existing] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.inquiryId, id));
      if (existing) throw new AppError(409, "A quote order already exists for this request.");
      const [order] = await tx.insert(orders).values({ reference: orderRef(), userId: row.userId, inquiryId: row.id, kind: /website/i.test(row.subject) ? "website" : "service", description: row.subject, amount: input.quote, platformRevenue: input.quote }).returning();
      reference = order.reference; orderId = order.id;
      await recordEvent(tx, { type: "New order", userId: row.userId, actor: row, detail: row.subject, reference, amount: money(order.amount), dashboard: "/admin#orders" });
    }
    const response = input.quote ? `${input.response}\n\nQuoted amount: ${money(input.quote)}${orderId ? "" : " · Contact support to proceed with your quote."}` : input.response;
    await tx.update(inbox).set({ status: "responded", response }).where(eq(inbox.id, id));
    const origin = canonicalOrigin();
    await queueCustomerMail(tx, { to: row.email, heading: input.quote ? "Your service quotation" : "Reply from Johnson Digital Empire", fields: { Subject: row.subject, Reference: reference, Reply: response }, link: origin ? origin + (orderId ? `/checkout?order=${orderId}` : row.userId ? "/dashboard?tab=inbox" : "/contact") : undefined, label: orderId ? "Review your quote" : "Open Johnson Digital Empire" });
    await recordEvent(tx, { type: input.quote ? "Service quotation sent" : "Enquiry reply sent", userId: row.userId ?? undefined, actor: { name: row.name, email: row.email, phone: row.phone }, reference, detail: row.subject, admin: false });
    return { ok: true, reference };
  });
  triggerMail();
  return result;
}

export async function placeOrder(user: User, raw: unknown) {
  const input = z.object({ kind: z.enum(["plan", "product"]), slug: z.string().min(1).max(140) }).parse(raw);
  await initializeCatalog();
  const item = input.kind === "product" ? await getListing(input.slug) : null;
  const result = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    let draft: typeof orders.$inferInsert;
    if (input.kind === "plan") {
      const [plan] = await tx.select().from(packages).where(and(eq(packages.slug, input.slug), eq(packages.active, true)));
      if (!plan) throw new AppError(404, "This package is no longer offered.");
      draft = { kind: plan.slug === "basic" ? "advertising" : "subscription", packageSlug: plan.slug, packageDays: plan.days, packageSlots: plan.slots, description: `${plan.name} advertising package`, amount: plan.price, platformRevenue: plan.price, userId: user.id, reference: orderRef() };
    } else {
      const product = item?.listing;
      if (!product?.ownerId || product.example || product.kind !== "products" || !product.price) throw new AppError(404, "This item is not available to purchase online.");
      if (product.ownerId === user.id) throw new AppError(400, "You cannot purchase your own listing.");
      const rate = Math.max(0, Math.min(100, Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 5) || 0));
      draft = { kind: "product", sellerId: product.ownerId, listingId: product.id, description: product.title, amount: product.price, platformRevenue: Math.round(product.price * rate / 100), userId: user.id, reference: orderRef() };
    }
    const [pending] = await tx.select().from(orders).where(and(eq(orders.userId, user.id), inArray(orders.status, ["awaiting_payment", "processing"]), draft.listingId ? eq(orders.listingId, draft.listingId) : eq(orders.packageSlug, draft.packageSlug!))).orderBy(desc(orders.createdAt)).limit(1);
    if (pending) return pending;
    const [order] = await tx.insert(orders).values(draft).returning();
    await recordEvent(tx, { type: "New order", actor: user, reference: order.reference, detail: order.description, amount: money(order.amount), dashboard: "/admin#orders" });
    return order;
  });
  triggerMail();
  return result;
}
export async function requestRefund(user: User, orderId: string, raw: unknown) {
  if (!UUID.test(orderId)) throw new AppError(404, "Order not found.");
  const input = z.object({ reason: cleanString(10, 1000, "Refund reason") }).parse(raw);
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, user.id))).for("update");
    if (!order || !["paid", "completed"].includes(order.status)) throw new AppError(409, "Only confirmed orders can be submitted for a refund.");
    const [row] = await tx.insert(refunds).values({ userId: user.id, orderId, reason: input.reason }).onConflictDoNothing().returning();
    if (!row) throw new AppError(409, "A refund request already exists for this order.");
    await recordEvent(tx, { type: "Refund request", actor: user, reference: order.reference, detail: order.description, amount: money(order.amount), dashboard: "/admin#refunds" });
    return { ok: true, reference: row.id };
  });
  triggerMail();
  return result;
}
export async function completeOrder(user: User, orderId: string) {
  if (!UUID.test(orderId)) throw new AppError(404, "Order not found.");
  return db.transaction(async (tx) => {
    const [order] = await tx.update(orders).set({ status: "completed" }).where(and(eq(orders.id, orderId), eq(orders.status, "paid"), user.role === "admin" ? undefined : eq(orders.sellerId, user.id))).returning();
    if (!order) throw new AppError(409, "Only confirmed orders that you manage can be completed.");
    await recordEvent(tx, { type: "Order completed", userId: order.userId, reference: order.reference, detail: order.description, admin: false });
    return { ok: true };
  });
}

export async function favorite(user: User, slug: string, save: boolean) {
  const row = await getListing(slug);
  if (!row) throw new AppError(404, "Listing not found.");
  if (save) await db.insert(bookmarks).values({ listingId: row.listing.id, userId: user.id }).onConflictDoNothing();
  else await db.delete(bookmarks).where(and(eq(bookmarks.listingId, row.listing.id), eq(bookmarks.userId, user.id)));
  return { saved: save };
}
export async function savedListings(user: User) {
  const rows = await db.select({ item: listings }).from(bookmarks).innerJoin(listings, eq(bookmarks.listingId, listings.id)).where(and(eq(bookmarks.userId, user.id), publicCondition())).orderBy(desc(bookmarks.createdAt)).limit(100);
  return rows.map((row) => card(row.item));
}
export async function recordView(slug: string, key: string) {
  const row = await getListing(slug);
  if (row && await hitRate(`view:${row.listing.id}:${key}`, 1, 900)) await db.update(listings).set({ views: sql`${listings.views} + 1` }).where(eq(listings.id, row.listing.id));
  return { ok: true };
}
export async function myDashboard(user: User) {
  const [items, purchases, pay, sales, messages, subs, log, refundRows] = await Promise.all([
    db.select().from(listings).where(and(eq(listings.ownerId, user.id), sql`${listings.status} <> 'archived'`)).orderBy(desc(listings.createdAt)).limit(100),
    db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(100),
    db.select({ id: payments.id, status: payments.status, date: payments.createdAt, amount: payments.amount, method: payments.method, receipt: payments.receipt, externalRef: payments.externalRef, reference: orders.reference, description: orders.description, orderId: orders.id }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(orders.userId, user.id)).orderBy(desc(payments.createdAt)).limit(110),
    db.select().from(orders).where(eq(orders.sellerId, user.id)).orderBy(desc(orders.createdAt)).limit(100),
    db.select().from(inbox).where(or(eq(inbox.userId, user.id), eq(inbox.recipientId, user.id))).orderBy(desc(inbox.createdAt)).limit(100),
    db.select({ slug: subscriptions.packageSlug, endsAt: subscriptions.endsAt, startsAt: subscriptions.startsAt, slots: subscriptions.slots, name: packages.name }).from(subscriptions).innerJoin(packages, eq(packages.slug, subscriptions.packageSlug)).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.endsAt)).limit(30),
    db.select().from(activities).where(eq(activities.userId, user.id)).orderBy(desc(activities.createdAt)).limit(80),
    db.select().from(refunds).where(eq(refunds.userId, user.id)).orderBy(desc(refunds.createdAt)).limit(40),
  ]);
  return { items, purchases, pay, sales, messages, subs, log, refunds: refundRows };
}
