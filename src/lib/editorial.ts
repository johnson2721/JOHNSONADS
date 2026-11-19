import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assets, categoryComments, categoryContent, categoryUpdates, content, listings, users, type DbTx, type User } from "@/db/schema";
import { CATEGORIES, categoryName } from "./catalog";
import { cleanString, mediaPath, protectMessage } from "./marketplace";
import { recordEvent, triggerMail } from "./mail";
import { card, publicCondition } from "./public-data";
import { AppError, UUID } from "./security";

function categoryKey(key: string) {
  if (!CATEGORIES.some((category) => category.key === key)) throw new AppError(404, "Category not found.");
  return key;
}
const optional = (max: number) => z.string().trim().max(max).default("");
const picture = z.uuid().nullable().default(null);
const web = optional(250).refine((value) => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes("."); } catch { return false; }
}, "Enter a public website address starting with https://.");
const idOk = (id: string) => { if (!UUID.test(id)) throw new AppError(404, "This entry was not found."); };
async function ownPhoto(tx: DbTx, user: User, id: string | null) {
  if (!id) return;
  const [found] = await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.id, id), eq(assets.ownerId, user.id)));
  if (!found) throw new AppError(400, "Choose a photo uploaded from your account.");
}
const consoleRef = "/admin#categories";
export async function publicCategory(key: string) {
  categoryKey(key);
  const [[settings], updates, comments, sellers] = await Promise.all([
    db.select({ heading: categoryContent.heading, summary: categoryContent.summary, description: categoryContent.description, coverId: categoryContent.coverId, coverAlt: categoryContent.coverAlt, commentsEnabled: categoryContent.commentsEnabled }).from(categoryContent).where(eq(categoryContent.key, key)),
    db.select({ id: categoryUpdates.id, title: categoryUpdates.title, body: categoryUpdates.body, photoId: categoryUpdates.photoId, photoAlt: categoryUpdates.photoAlt, date: categoryUpdates.publishedAt }).from(categoryUpdates).where(and(eq(categoryUpdates.category, key), eq(categoryUpdates.status, "published"))).orderBy(desc(categoryUpdates.publishedAt)).limit(16),
    db.select({ id: categoryComments.id, name: categoryComments.displayName, body: categoryComments.body, staff: categoryComments.staff, date: categoryComments.createdAt }).from(categoryComments).leftJoin(users, eq(categoryComments.userId, users.id)).where(and(eq(categoryComments.category, key), eq(categoryComments.status, "visible"), or(sql`${users.id} is null`, eq(users.suspended, false)))).orderBy(desc(categoryComments.createdAt)).limit(35),
    db.select().from(listings).where(and(publicCondition(), eq(listings.managedCategory, key))).orderBy(desc(listings.updatedAt)).limit(8),
  ]);
  return { settings: settings ?? null, updates, comments, sellers: sellers.map(card) };
}
export async function categoryWorkspace(key: string) {
  categoryKey(key);
  const [[settings], updates, comments, sellers] = await Promise.all([
    db.select().from(categoryContent).where(eq(categoryContent.key, key)),
    db.select().from(categoryUpdates).where(eq(categoryUpdates.category, key)).orderBy(desc(categoryUpdates.updatedAt)).limit(100),
    db.select({ id: categoryComments.id, body: categoryComments.body, displayName: categoryComments.displayName, status: categoryComments.status, staff: categoryComments.staff, createdAt: categoryComments.createdAt }).from(categoryComments).where(eq(categoryComments.category, key)).orderBy(sql`case when ${categoryComments.status} = 'pending' then 0 else 1 end`, desc(categoryComments.createdAt)).limit(120),
    db.select().from(listings).where(and(eq(listings.managedCategory, key), sql`${listings.status} <> 'archived'`)).orderBy(desc(listings.updatedAt)).limit(100),
  ]);
  return { settings: settings ?? null, updates, comments, sellers };
}
export async function saveCategory(admin: User, key: string, raw: unknown) {
  categoryKey(key);
  const input = z.object({ heading: optional(85), summary: optional(230), description: optional(2000), coverId: picture, coverAlt: optional(140), commentsEnabled: z.boolean() }).parse(raw);
  if (input.coverId && !input.coverAlt) throw new AppError(400, "Describe the category cover image for visitors using screen readers.");
  return db.transaction(async (tx) => {
    await ownPhoto(tx, admin, input.coverId);
    const update = { ...input, updatedAt: new Date() };
    const [row] = await tx.insert(categoryContent).values({ key, ...update }).onConflictDoUpdate({ target: categoryContent.key, set: update }).returning();
    await recordEvent(tx, { actor: admin, type: "Category page updated", reference: key, admin: false });
    return row;
  });
}
export async function saveCategoryUpdate(admin: User, key: string, raw: unknown, id?: string) {
  categoryKey(key);
  if (id) idOk(id);
  const input = z.object({ title: cleanString(3, 100, "Update title"), body: cleanString(5, 3000, "Update"), photoId: picture, photoAlt: optional(140), status: z.enum(["draft", "published"]) }).parse(raw);
  if (input.photoId && !input.photoAlt) throw new AppError(400, "Describe the update image for visitors using screen readers.");
  return db.transaction(async (tx) => {
    await ownPhoto(tx, admin, input.photoId);
    const now = new Date();
    let row;
    if (id) {
      const [current] = await tx.select().from(categoryUpdates).where(and(eq(categoryUpdates.id, id), eq(categoryUpdates.category, key))).for("update");
      if (!current) throw new AppError(404, "Update not found in this category.");
      [row] = await tx.update(categoryUpdates).set({ ...input, updatedAt: now, publishedAt: input.status === "published" ? current.publishedAt ?? now : null }).where(eq(categoryUpdates.id, id)).returning();
    } else [row] = await tx.insert(categoryUpdates).values({ ...input, category: key, publishedAt: input.status === "published" ? now : null }).returning();
    await recordEvent(tx, { actor: admin, type: input.status === "published" ? "Category update published" : "Category update saved as draft", reference: row.id, detail: row.title, admin: false });
    return row;
  });
}
export async function deleteCategoryUpdate(admin: User, key: string, id: string) {
  categoryKey(key); idOk(id);
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(categoryUpdates).where(and(eq(categoryUpdates.category, key), eq(categoryUpdates.id, id))).returning({ title: categoryUpdates.title });
    if (!row) throw new AppError(404, "Update not found in this category.");
    await recordEvent(tx, { actor: admin, type: "Category update removed", reference: id, detail: row.title, admin: false });
    return { ok: true };
  });
}
export async function saveSellerProfile(admin: User, key: string, raw: unknown, id?: string) {
  categoryKey(key); if (id) idOk(id);
  const input = z.object({ name: cleanString(2, 100, "Seller or business name"), category: cleanString(2, 60, "Specialty"), location: cleanString(2, 90, "Location"), description: cleanString(15, 5000, "Description"), website: web, photoId: picture, status: z.enum(["draft", "approved"]) }).parse(raw);
  return db.transaction(async (tx) => {
    await ownPhoto(tx, admin, input.photoId);
    const entry = { title: input.name, category: input.category, location: input.location, description: input.description, sellerWebsite: input.website, images: input.photoId ? [mediaPath(input.photoId)] : [], status: input.status, updatedAt: new Date() };
    let row;
    if (id) {
      [row] = await tx.update(listings).set(entry).where(and(eq(listings.id, id), eq(listings.managedCategory, key), sql`${listings.status} <> 'archived'`)).returning();
      if (!row) throw new AppError(404, "Seller profile not found in this category.");
    } else {
      const slug = `${input.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "seller"}-${randomUUID().slice(0, 8)}`;
      [row] = await tx.insert(listings).values({ ...entry, slug, kind: "businesses", badge: "Seller profile", managedCategory: key }).returning();
    }
    await recordEvent(tx, { actor: admin, type: input.status === "approved" ? "Seller profile published" : "Seller profile draft saved", reference: row.slug, detail: row.title, admin: false });
    return row;
  });
}
export async function archiveSellerProfile(admin: User, key: string, id: string) {
  categoryKey(key); idOk(id);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(listings).set({ status: "archived", updatedAt: new Date() }).where(and(eq(listings.id, id), eq(listings.managedCategory, key))).returning({ slug: listings.slug });
    if (!row) throw new AppError(404, "Seller profile not found in this category.");
    await recordEvent(tx, { actor: admin, type: "Seller profile archived", reference: row.slug, admin: false });
    return { ok: true };
  });
}
export async function postCategoryComment(user: User, key: string, raw: unknown, staff = false) {
  categoryKey(key);
  const { body } = z.object({ body: cleanString(3, 1000, "Comment") }).parse(raw);
  protectMessage(body);
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx.select({ enabled: categoryContent.commentsEnabled }).from(categoryContent).where(eq(categoryContent.key, key));
    if (!staff && settings?.enabled === false) throw new AppError(409, "New comments are paused for this category.");
    const member = user.name.trim().split(/\s+/).filter(Boolean);
    const displayName = staff ? "Johnson Digital Empire" : (user.businessName.trim() || `${member[0] || "Member"}${member.length > 1 ? ` ${[...member.at(-1)!][0]}.` : ""}`);
    const [row] = await tx.insert(categoryComments).values({ category: key, userId: user.id, displayName, body, staff, status: staff ? "visible" : "pending" }).returning({ id: categoryComments.id, status: categoryComments.status });
    await recordEvent(tx, { actor: user, type: staff ? "Staff category comment published" : "New category comment", reference: row.id, detail: categoryName(key), admin: !staff, dashboard: consoleRef });
    return row;
  });
  if (!staff) triggerMail();
  return result;
}
export async function moderateComment(admin: User, key: string, id: string, raw: unknown) {
  categoryKey(key); idOk(id);
  const { status } = z.object({ status: z.enum(["visible", "hidden"]) }).parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(categoryComments).set({ status }).where(and(eq(categoryComments.category, key), eq(categoryComments.id, id))).returning({ id: categoryComments.id });
    if (!row) throw new AppError(404, "Comment not found in this category.");
    await recordEvent(tx, { actor: admin, type: status === "visible" ? "Category comment approved" : "Category comment hidden", reference: id, detail: categoryName(key), admin: false });
    return { ok: true };
  });
}
export async function saveHomepagePhoto(admin: User, raw: unknown) {
  const { photoId, alt } = z.object({ photoId: picture, alt: optional(140) }).parse(raw);
  if (photoId && !alt) throw new AppError(400, "Describe the homepage image for visitors using screen readers.");
  await db.transaction(async (tx) => {
    await ownPhoto(tx, admin, photoId);
    for (const [key, value] of [["homepageCover", photoId ?? ""], ["homepageCoverAlt", photoId ? alt : ""]]) {
      await tx.insert(content).values({ key, value }).onConflictDoUpdate({ target: content.key, set: { value, updatedAt: new Date() } });
    }
    await recordEvent(tx, { actor: admin, type: "Homepage photo updated", admin: false });
  });
  return { ok: true };
}
export async function isEditorialPhoto(id: string) {
  const [covers, updates, home] = await Promise.all([
    db.select({ key: categoryContent.key }).from(categoryContent).where(eq(categoryContent.coverId, id)).limit(1),
    db.select({ id: categoryUpdates.id }).from(categoryUpdates).where(and(eq(categoryUpdates.photoId, id), eq(categoryUpdates.status, "published"), isNotNull(categoryUpdates.publishedAt))).limit(1),
    db.select({ key: content.key }).from(content).where(and(eq(content.key, "homepageCover"), eq(content.value, id))).limit(1),
  ]);
  return !!(covers.length || updates.length || home.length);
}
