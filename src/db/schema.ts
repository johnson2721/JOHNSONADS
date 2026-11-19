import { sql } from "drizzle-orm";
import { boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const date = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const users = pgTable("jde_users", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  phone: text().notNull(),
  country: text().notNull().default("Kenya"),
  businessName: text("business_name").notNull().default(""),
  category: text().notNull().default("Other"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  adminSetupUntil: date("admin_setup_until"),
  role: text({ enum: ["customer", "seller", "admin"] }).notNull().default("customer"),
  verified: boolean().notNull().default(false),
  suspended: boolean().notNull().default(false),
  mfaSecret: text("mfa_secret"),
  mfaLastCounter: integer("mfa_last_counter").notNull().default(0),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("jde_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mfa: boolean().notNull().default(false),
  expiresAt: date("expires_at").notNull(),
}, (t) => [index("jde_sessions_user").on(t.userId), index("jde_sessions_expiry").on(t.expiresAt)]);

export const authTokens = pgTable("jde_auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text({ enum: ["verify", "reset", "admin-setup"] }).notNull(),
  sealedPayload: text("sealed_payload"),
  expiresAt: date("expires_at").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_auth_tokens_user").on(t.userId, t.kind), index("jde_auth_tokens_expiry").on(t.expiresAt)]);

export const rateBuckets = pgTable("jde_rate_limits", {
  key: text().primaryKey(),
  count: integer().notNull(),
  expiresAt: date("expires_at").notNull(),
}, (t) => [index("jde_rate_expiry").on(t.expiresAt)]);

export const activities = pgTable("jde_activities", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  type: text().notNull(),
  reference: text().notNull().default(""),
  detail: text().notNull().default(""),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_activity_user").on(t.userId, t.createdAt)]);

export const assets = pgTable("jde_assets", {
  id: uuid().defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  mime: text().notNull(),
  objectKey: text("object_key"),
  bytes: bytea("bytes"),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const listings = pgTable("jde_listings", {
  id: uuid().defaultRandom().primaryKey(),
  slug: text().notNull().unique(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  title: text().notNull(),
  kind: text().notNull(),
  category: text().notNull(),
  description: text().notNull(),
  location: text().notNull().default("Nairobi, Kenya"),
  price: integer(),
  priceUnit: text("price_unit").notNull().default(""),
  images: jsonb().$type<string[]>().notNull().default([]),
  status: text({ enum: ["draft", "pending", "approved", "rejected", "archived"] }).notNull().default("draft"),
  moderationNote: text("moderation_note").notNull().default(""),
  promotedUntil: date("promoted_until"),
  views: integer().notNull().default(0),
  example: boolean().notNull().default(false),
  badge: text().notNull().default(""),
  managedCategory: text("managed_category"),
  sellerWebsite: text("seller_website").notNull().default(""),
  rank: integer().notNull().default(0),
  createdAt: date("created_at").notNull().defaultNow(),
  updatedAt: date("updated_at").notNull().defaultNow(),
}, (t) => [index("jde_listings_public").on(t.status, t.kind, t.createdAt), index("jde_listings_owner").on(t.ownerId), index("jde_listings_managed").on(t.managedCategory, t.status), check("jde_listing_price_nonnegative", sql`${t.price} >= 0`)]);

export const bookmarks = pgTable("jde_bookmarks", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.listingId] })]);

export const packages = pgTable("jde_packages", {
  slug: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  price: integer().notNull(),
  days: integer().notNull(),
  slots: integer().notNull().default(1),
  features: jsonb().$type<string[]>().notNull().default([]),
  active: boolean().notNull().default(true),
  rank: integer().notNull().default(0),
}, (t) => [check("jde_package_values", sql`${t.price} > 0 and ${t.days} > 0 and ${t.slots} > 0`)]);

export const inbox = pgTable("jde_inbox", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  listingId: uuid("listing_id").references(() => listings.id),
  recipientId: uuid("recipient_id").references(() => users.id),
  kind: text({ enum: ["contact", "support", "business", "partnership", "complaint", "service", "enquiry"] }).notNull(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull().default(""),
  subject: text().notNull(),
  message: text().notNull(),
  status: text({ enum: ["new", "responded", "closed"] }).notNull().default("new"),
  response: text().notNull().default(""),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_inbox_user").on(t.userId, t.createdAt), index("jde_inbox_recipient").on(t.recipientId), index("jde_inbox_status").on(t.status, t.createdAt)]);

export const orders = pgTable("jde_orders", {
  id: uuid().defaultRandom().primaryKey(),
  reference: text().notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  sellerId: uuid("seller_id").references(() => users.id),
  listingId: uuid("listing_id").references(() => listings.id),
  inquiryId: uuid("inquiry_id").references(() => inbox.id),
  packageSlug: text("package_slug").references(() => packages.slug),
  packageDays: integer("package_days"),
  packageSlots: integer("package_slots"),
  kind: text({ enum: ["product", "advertising", "subscription", "website", "service"] }).notNull(),
  description: text().notNull(),
  amount: integer().notNull(),
  platformRevenue: integer("platform_revenue").notNull(),
  status: text({ enum: ["awaiting_payment", "processing", "paid", "completed", "refunded", "cancelled"] }).notNull().default("awaiting_payment"),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_orders_user").on(t.userId, t.createdAt), index("jde_orders_seller").on(t.sellerId), uniqueIndex("jde_orders_quote").on(t.inquiryId), check("jde_order_amount", sql`${t.amount} > 0 and ${t.platformRevenue} >= 0 and ${t.platformRevenue} <= ${t.amount}`)]);

export const payments = pgTable("jde_payments", {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  method: text({ enum: ["mpesa", "paypal", "binance", "lipwa"] }).notNull(),
  amount: integer().notNull(),
  providerAmount: text("provider_amount").notNull(),
  currency: text().notNull(),
  status: text({ enum: ["pending", "confirmed", "failed", "refunded"] }).notNull().default("pending"),
  providerId: text("provider_id"),
  providerRequest: text("provider_request"),
  phone: text(),
  externalRef: text("external_ref"),
  verificationHint: text("verification_hint"),
  checkoutUrl: text("checkout_url"),
  callback: jsonb().$type<{ merchant: string; receipt: string; amount: number; code: number; phone: string }>(),
  receipt: text().unique(),
  confirmedAt: date("confirmed_at"),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_payments_order").on(t.orderId), index("jde_payments_status").on(t.status, t.createdAt), uniqueIndex("jde_payments_provider").on(t.method, t.providerId), uniqueIndex("jde_payments_ext_ref").on(t.method, t.externalRef), uniqueIndex("jde_payments_active_order").on(t.orderId).where(sql`${t.status} in ('pending','confirmed','refunded')`)]);

export const subscriptions = pgTable("jde_subscriptions", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  packageSlug: text("package_slug").notNull().references(() => packages.slug),
  lastOrderId: uuid("last_order_id").notNull().references(() => orders.id),
  slots: integer().notNull().default(1),
  startsAt: date("starts_at").notNull().defaultNow(),
  endsAt: date("ends_at").notNull(),
}, (t) => [uniqueIndex("jde_subscription_unique").on(t.userId, t.packageSlug), index("jde_subscription_active").on(t.endsAt)]);

export const refunds = pgTable("jde_refunds", {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id).unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  reason: text().notNull(),
  decision: text().notNull().default(""),
  reference: text(),
  status: text({ enum: ["requested", "approved", "rejected", "refunded"] }).notNull().default("requested"),
  createdAt: date("created_at").notNull().defaultNow(),
  resolvedAt: date("resolved_at"),
});

export const expenses = pgTable("jde_expenses", {
  id: uuid().defaultRandom().primaryKey(),
  label: text().notNull(),
  amount: integer().notNull(),
  incurredAt: date("incurred_at").notNull().defaultNow(),
}, (t) => [index("jde_expense_date").on(t.incurredAt), check("jde_expense_amount", sql`${t.amount} > 0`)]);

export const content = pgTable("jde_content", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: date("updated_at").notNull().defaultNow(),
});

export const categoryContent = pgTable("jde_category_content", {
  key: text().primaryKey(),
  heading: text().notNull().default(""),
  summary: text().notNull().default(""),
  description: text().notNull().default(""),
  coverId: uuid("cover_id").references(() => assets.id, { onDelete: "set null" }),
  coverAlt: text("cover_alt").notNull().default(""),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  updatedAt: date("updated_at").notNull().defaultNow(),
});

export const categoryUpdates = pgTable("jde_category_updates", {
  id: uuid().defaultRandom().primaryKey(),
  category: text().notNull(),
  title: text().notNull(),
  body: text().notNull(),
  photoId: uuid("photo_id").references(() => assets.id, { onDelete: "set null" }),
  photoAlt: text("photo_alt").notNull().default(""),
  status: text({ enum: ["draft", "published"] }).notNull().default("draft"),
  publishedAt: date("published_at"),
  updatedAt: date("updated_at").notNull().defaultNow(),
}, (t) => [index("jde_category_updates_public").on(t.category, t.status, t.publishedAt)]);

export const categoryComments = pgTable("jde_category_comments", {
  id: uuid().defaultRandom().primaryKey(),
  category: text().notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  body: text().notNull(),
  staff: boolean().notNull().default(false),
  status: text({ enum: ["pending", "visible", "hidden"] }).notNull().default("pending"),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_category_comments_public").on(t.category, t.status, t.createdAt)]);

export const emailOutbox = pgTable("jde_email_outbox", {
  id: uuid().defaultRandom().primaryKey(),
  to: text().notNull(),
  subject: text().notNull(),
  heading: text().notNull(),
  fields: jsonb().$type<Record<string, string>>().notNull().default({}),
  link: text(),
  sealedLink: text("sealed_link"),
  label: text("label"),
  attempts: integer().notNull().default(0),
  status: text({ enum: ["pending", "sending", "sent", "failed"] }).notNull().default("pending"),
  lastError: text("last_error"),
  nextAttempt: date("next_attempt").notNull().defaultNow(),
  sentAt: date("sent_at"),
  createdAt: date("created_at").notNull().defaultNow(),
}, (t) => [index("jde_email_due").on(t.status, t.nextAttempt)]);

export type User = typeof users.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type DbTx = Parameters<Parameters<typeof import("./index").db.transaction>[0]>[0];
