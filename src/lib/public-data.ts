import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { content, listings, packages, users, type Listing } from "@/db/schema";
import { DEFAULT_PLANS, KINDS, SAMPLE_LISTINGS, type CardListing } from "./catalog";

let initialized: Promise<void> | undefined;
const examples = () => process.env.JDE_SEED_EXAMPLES !== "0";
export function initializeCatalog() {
  if (!initialized) initialized = (async () => {
    await db.insert(packages).values(DEFAULT_PLANS).onConflictDoNothing();
    if (examples()) await db.insert(listings).values(SAMPLE_LISTINGS.map((row) => ({ ...row, status: "approved" as const }))).onConflictDoNothing();
  })().catch((error) => { initialized = undefined; throw error; });
  return initialized;
}
export function publicCondition() {
  return and(eq(listings.status, "approved"), examples() ? undefined : eq(listings.example, false), or(sql`${listings.ownerId} is null`, sql`not exists (select 1 from ${users} where ${users.id} = ${listings.ownerId} and ${users.suspended} = true)`));
}
export function card(row: Listing): CardListing {
  return { slug: row.slug, title: row.title, description: row.description, kind: row.kind, category: row.category, location: row.location, price: row.price, priceUnit: row.priceUnit, images: row.images, badge: row.badge, managedCategory: row.managedCategory, example: row.example, featured: !!row.promotedUntil && row.promotedUntil > new Date() };
}
const featuredOrder = sql`coalesce(${listings.promotedUntil} > now(), false) desc`;
const searchPattern = (input: string) => `%${input.replace(/[\\%_]/g, "\\$&")}%`;
export async function findListings(params: { q?: string; kind?: string; location?: string; sort?: string; min?: string; max?: string; page?: number }) {
  await initializeCatalog();
  const q = params.q?.trim().slice(0, 100);
  const loc = params.location?.trim().slice(0, 80);
  const min = Number(params.min), max = Number(params.max);
  const kind = params.kind && (KINDS as readonly string[]).includes(params.kind) ? params.kind : undefined;
  const filter = and(publicCondition(), kind ? eq(listings.kind, kind) : undefined,
    q ? or(ilike(listings.title, searchPattern(q)), ilike(listings.description, searchPattern(q)), ilike(listings.category, searchPattern(q))) : undefined,
    loc ? ilike(listings.location, searchPattern(loc)) : undefined,
    params.min && Number.isSafeInteger(min) && min >= 0 && min <= 500_000_000 ? gte(listings.price, min) : undefined,
    params.max && Number.isSafeInteger(max) && max >= 0 && max <= 500_000_000 ? lte(listings.price, max) : undefined,
  );
  const order = params.sort === "price-low" ? [sql`${listings.price} asc nulls last`, desc(listings.createdAt)] : params.sort === "price-high" ? [sql`${listings.price} desc nulls last`, desc(listings.createdAt)] : params.sort === "newest" ? [asc(listings.example), desc(listings.createdAt)] : [featuredOrder, asc(listings.example), desc(listings.rank), desc(listings.createdAt)];
  const page = Math.max(1, Math.min(2000, params.page || 1));
  const [result, [{ total }]] = await Promise.all([
    db.select().from(listings).where(filter).orderBy(...order, asc(listings.slug)).limit(24).offset((page - 1) * 24),
    db.select({ total: count() }).from(listings).where(filter),
  ]);
  return { items: result.map(card), total, page };
}
export async function getHomeData() {
  await initializeCatalog();
  const top = (kind?: string, max = 4) => db.select().from(listings).where(and(publicCondition(), kind ? eq(listings.kind, kind) : undefined)).orderBy(featuredOrder, asc(listings.example), desc(listings.rank), desc(listings.createdAt)).limit(max);
  const [trending, businesses, property, vehicles, featured, plans, settings] = await Promise.all([
    top(), top("businesses", 2), top("property", 2), top("vehicles", 2), top("advertising", 2),
    db.select().from(packages).where(eq(packages.active, true)).orderBy(asc(packages.rank)), db.select().from(content),
  ]);
  return { trending: trending.map(card), businesses: businesses.map(card), property: property.map(card), vehicles: vehicles.map(card), featured: featured.map(card), plans, content: Object.fromEntries(settings.map((item) => [item.key, item.value])) };
}
export async function getPlans() {
  await initializeCatalog();
  return db.select().from(packages).where(eq(packages.active, true)).orderBy(asc(packages.rank));
}
export async function getListing(slug: string) {
  await initializeCatalog();
  if (slug.length > 140) return null;
  const [row] = await db.select({ listing: listings, seller: { name: users.name, businessName: users.businessName, verified: users.verified } }).from(listings).leftJoin(users, eq(listings.ownerId, users.id)).where(and(eq(listings.slug, slug), publicCondition()));
  return row ?? null;
}
