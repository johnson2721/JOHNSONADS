import { and, count, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { content, expenses, inbox, listings, orders, packages, payments, refunds, subscriptions, users, type User } from "@/db/schema";
import { TARGET } from "./catalog";
import { initializeCatalog } from "./public-data";
import { recentMail } from "./mail";
import { hostedLipwaLink, lipwaVerificationReady } from "./lipwa";

const eat = 3 * 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function calendar() {
  const offsetNow = Date.now() + eat;
  const day = iso(offsetNow); const month = day.slice(0, 7);
  const days = Array.from({ length: 31 }, (_, i) => iso(offsetNow - (30 - i) * 86_400_000));
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(offsetNow); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (5 - i), 1)).toISOString().slice(0, 7); });
  return { day, month, days, months, start: new Date(`${months[0]}-01T00:00:00+03:00`) };
}
export async function financialSummary() {
  const { day, month, days, months, start } = calendar();
  const payDay = sql<string>`to_char(${payments.confirmedAt} at time zone 'Africa/Nairobi','YYYY-MM-DD')`;
  const refundDay = sql<string>`to_char(${refunds.resolvedAt} at time zone 'Africa/Nairobi','YYYY-MM-DD')`;
  const expenseDay = sql<string>`to_char(${expenses.incurredAt} at time zone 'Africa/Nairobi','YYYY-MM-DD')`;
  const [sales, returns, costs, [{ total: customers }], [{ total: businesses }], [{ total: ads }], [{ total: numberOrders }], [{ total: pendingPayments }], [{ total: confirmedPayments }], [{ total: activeSubs }], [lifetime], [allExpenses]] = await Promise.all([
    db.select({ day: payDay, kind: orders.kind, gross: sql<string>`sum(${payments.amount})`, revenue: sql<string>`sum(${orders.platformRevenue})` }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(and(inArray(payments.status, ["confirmed", "refunded"]), gte(payments.confirmedAt, start))).groupBy(payDay, orders.kind),
    db.select({ day: refundDay, kind: orders.kind, gross: sql<string>`sum(${orders.amount})`, revenue: sql<string>`sum(${orders.platformRevenue})` }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).where(and(eq(refunds.status, "refunded"), gte(refunds.resolvedAt, start))).groupBy(refundDay, orders.kind),
    db.select({ day: expenseDay, amount: sql<string>`sum(${expenses.amount})` }).from(expenses).where(gte(expenses.incurredAt, start)).groupBy(expenseDay),
    db.select({ total: count() }).from(users).where(ne(users.role, "admin")),
    db.select({ total: count() }).from(users).where(and(eq(users.verified, true), eq(users.suspended, false), ne(users.role, "admin"), sql`(${users.businessName} <> '' or ${users.role} = 'seller')`)),
    db.select({ total: count() }).from(listings).where(and(eq(listings.example, false), inArray(listings.kind, ["advertising", "businesses"]))),
    db.select({ total: count() }).from(orders),
    db.select({ total: count() }).from(payments).where(eq(payments.status, "pending")),
    db.select({ total: count() }).from(payments).where(eq(payments.status, "confirmed")),
    db.select({ total: count() }).from(subscriptions).where(and(gt(subscriptions.endsAt, new Date()), ne(subscriptions.packageSlug, "basic"))),
    db.select({ gross: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'confirmed'), 0)` }).from(payments),
    db.select({ amount: sql<string>`coalesce(sum(${expenses.amount}), 0)` }).from(expenses),
  ]);
  const entries = [...sales.map((x) => ({ ...x, sign: 1 })), ...returns.map((x) => ({ ...x, sign: -1 }))];
  const aggregate = (test: (date: string) => boolean) => {
    let gross = 0, revenue = 0, expense = 0;
    const kinds: Record<string, number> = { product: 0, advertising: 0, subscription: 0, website: 0, service: 0 };
    for (const item of entries) if (test(item.day)) { gross += Number(item.gross) * item.sign; revenue += Number(item.revenue) * item.sign; kinds[item.kind] += Number(item.revenue) * item.sign; }
    for (const cost of costs) if (test(cost.day)) expense += Number(cost.amount);
    return { gross, revenue, expense, profit: revenue - expense, kinds };
  };
  const today = aggregate((d) => d === day); const thisMonth = aggregate((d) => d.startsWith(month));
  const graph = (label: string, test: (d: string) => boolean) => ({ label, ...aggregate(test) });
  return { customers, businesses, ads, orders: numberOrders, pendingPayments, confirmedPayments, activeSubs, totalSales: Number(lifetime.gross), totalExpenses: Number(allExpenses.amount), today, thisMonth, target: TARGET, progress: Math.max(0, Math.min(100, Math.round(thisMonth.profit / TARGET * 100))), chart: {
    daily: days.slice(-7).map((d) => graph(d.slice(5), (v) => v === d)),
    weekly: [0, 1, 2, 3].map((i) => { const first = days[3 + 7 * i], last = days[9 + 7 * i]; return graph(first.slice(5), (d) => d >= first && d <= last); }),
    monthly: months.map((m) => graph(m, (d) => d.startsWith(m))),
  } };
}
const safeUsers = { id: users.id, name: users.name, email: users.email, phone: users.phone, country: users.country, businessName: users.businessName, category: users.category, role: users.role, verified: users.verified, suspended: users.suspended, createdAt: users.createdAt };
export async function adminDashboard() {
  await initializeCatalog();
  const [stats, accounts, items, messages, orderRows, pay, plans, settings, refundRows, expenseRows, notificationRows] = await Promise.all([
    financialSummary(), db.select(safeUsers).from(users).orderBy(desc(users.createdAt)).limit(150),
    db.select().from(listings).where(eq(listings.example, false)).orderBy(sql`case when ${listings.status} = 'pending' then 0 else 1 end`, desc(listings.createdAt)).limit(150),
    db.select().from(inbox).orderBy(desc(inbox.createdAt)).limit(150), db.select().from(orders).orderBy(desc(orders.createdAt)).limit(150),
    db.select({ id: payments.id, orderId: orders.id, reference: orders.reference, description: orders.description, accountId: orders.userId, amount: payments.amount, method: payments.method, status: payments.status, date: payments.createdAt, externalRef: payments.externalRef, receipt: payments.receipt, verificationHint: payments.verificationHint }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).orderBy(desc(payments.createdAt)).limit(150),
    db.select().from(packages).orderBy(packages.rank), db.select().from(content), db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(100),
    db.select().from(expenses).orderBy(desc(expenses.incurredAt)).limit(100), recentMail(),
  ]);
  return { stats, accounts, items, messages, orders: orderRows, payments: pay, plans, settings, refunds: refundRows, expenses: expenseRows, notifications: notificationRows, lipwa: { enabled: Boolean(hostedLipwaLink()), verificationReady: lipwaVerificationReady() } };
}
export type DashboardData = Awaited<ReturnType<typeof adminDashboard>>;

export async function financialCsv(admin: User) {
  const since = new Date(Date.now() - 366 * 86_400_000);
  const paymentRows = await db.select({ order: orders.reference, item: orders.description, status: payments.status, method: payments.method, gross: payments.amount, revenue: orders.platformRevenue, confirmed: payments.confirmedAt, date: payments.createdAt, transaction: payments.externalRef }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(gte(payments.createdAt, since)).orderBy(desc(payments.createdAt)).limit(25_000);
  const costRows = await db.select().from(expenses).where(gte(expenses.incurredAt, since)).orderBy(desc(expenses.incurredAt)).limit(25_000);
  const returnRows = await db.select({ order: orders.reference, item: orders.description, gross: orders.amount, revenue: orders.platformRevenue, date: refunds.resolvedAt, transaction: refunds.reference }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).where(and(eq(refunds.status, "refunded"), gte(refunds.resolvedAt, since))).orderBy(desc(refunds.resolvedAt)).limit(25_000);
  const cell = (value: unknown) => { const val = value === null ? "" : String(value); return `"${(typeof value === "string" && /^[\s]*[=+@-]|^[\r\n\t]/.test(val) ? "'" + val : val).replaceAll('"', '""')}"`; };
  const row = (...values: unknown[]) => values.map(cell).join(",");
  const csv = [row("Record type", "Order", "Description", "Status", "Method", "Gross KES", "Platform revenue KES", "Expense KES", "Date UTC", "Transaction"),
    ...paymentRows.map((p) => row("Payment", p.order, p.item, p.status, p.method, p.confirmed ? p.gross : 0, p.confirmed ? p.revenue : 0, 0, (p.confirmed ?? p.date).toISOString(), p.transaction)),
    ...returnRows.map((r) => row("Refund", r.order, r.item, "refunded", "", -r.gross, -r.revenue, 0, r.date?.toISOString(), r.transaction)),
    ...costRows.map((c) => row("Expense", "", c.label, "recorded", "", 0, 0, c.amount, c.incurredAt.toISOString(), "")),
  ].join("\r\n");
  const { activities } = await import("@/db/schema");
  await db.insert(activities).values({ userId: admin.id, type: "Financial report exported" });
  return new Response("\uFEFF" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="jde-financial-report.csv"', "Cache-Control": "no-store" } });
}
