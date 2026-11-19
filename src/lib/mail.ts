import nodemailer from "nodemailer";
import { after } from "next/server";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, emailOutbox, type DbTx } from "@/db/schema";
import { BRAND, SUPPORT_EMAIL } from "./catalog";
import { canonicalOrigin, unseal } from "./security";

export const smtpReady = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && (!process.env.SMTP_USER || process.env.SMTP_PASS));
const maxAttempts = 10;
const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));

type Recipient = { id?: string; name: string; email: string; phone?: string };
type Event = { type: string; actor?: Recipient | null; userId?: string; reference?: string; detail?: string; amount?: string; paymentStatus?: string; admin?: boolean; dashboard?: string };
export async function recordEvent(tx: DbTx, event: Event) {
  const { type, actor, reference = "", detail = "" } = event;
  await tx.insert(activities).values({ userId: event.userId ?? actor?.id, type, reference, detail });
  if (event.admin === false) return;
  const when = dateFormat.format(new Date()) + " EAT";
  const dashboard = event.dashboard ?? "/admin";
  const fields: Record<string, string> = event.paymentStatus
    ? { Activity: type, Reference: reference || "—", Status: event.paymentStatus, "Date and time": when }
    : { Activity: type, Customer: actor?.name ?? "—", Email: actor?.email ?? "—", ...(actor?.phone ? { Phone: actor.phone } : {}), ...(detail ? { "Listing or service": detail } : {}), ...(reference ? { Reference: reference } : {}), ...(event.amount ? { Amount: event.amount } : {}), "Date and time": when };
  fields["Dashboard reference"] = dashboard;
  const origin = canonicalOrigin();
  await tx.insert(emailOutbox).values({ to: process.env.ADMIN_NOTIFICATION_EMAIL || SUPPORT_EMAIL, subject: `${BRAND} - New Customer Activity`, heading: "New customer activity", fields, ...(origin ? { link: origin + dashboard, label: "Open the admin dashboard" } : {}) });
}

export async function queueCustomerMail(tx: DbTx, values: { to: string; heading: string; fields: Record<string, string>; link?: string; sealedLink?: string; label?: string }) {
  await tx.insert(emailOutbox).values({ ...values, subject: `${BRAND} - ${values.heading}` });
}
function template(heading: string, fields: Record<string, string>, link: string | null, label: string | null) {
  const rows = Object.entries(fields).map(([key, val]) => `<tr><td style="width:34%;padding:10px;border-bottom:1px solid #ece8df;font-weight:600">${escape(key)}</td><td style="padding:10px;border-bottom:1px solid #ece8df;white-space:pre-wrap">${escape(val)}</td></tr>`).join("");
  const button = link && label ? `<p style="margin:24px 0 6px"><a style="display:inline-block;background:#efb832;color:#171611;padding:13px 18px;text-decoration:none;border-radius:7px;font-weight:700" href="${escape(link)}">${escape(label)}</a></p>` : "";
  return `<div style="background:#f6f4ef;padding:28px 12px;font:15px/1.6 Arial,sans-serif;color:#26231f"><div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden"><header style="background:#171611;color:#efb832;padding:20px 26px;font-size:13px;font-weight:800;letter-spacing:1.5px">${BRAND}</header><div style="padding:24px 26px"><h1 style="margin:0 0 16px;font-size:25px">${escape(heading)}</h1><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>${button}</div><footer style="padding:12px 26px 24px;color:#666;font-size:12px">An automated message from Johnson Digital Empire.</footer></div></div>`;
}

let current: Promise<{ sent: number; failed: number }> | null = null;
let moreWork = false;
async function drain(batch: number) {
  if (!smtpReady()) return { sent: 0, failed: 0 };
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465 && process.env.SMTP_ALLOW_INSECURE !== "1", connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined });
  const reserved = await db.transaction(async (tx) => {
    const due = await tx.select().from(emailOutbox).where(and(inArray(emailOutbox.status, ["pending", "sending"]), lte(emailOutbox.nextAttempt, new Date()))).orderBy(sql`(${emailOutbox.sealedLink} is not null) desc`, emailOutbox.nextAttempt).limit(batch).for("update", { skipLocked: true });
    if (due.length) await tx.update(emailOutbox).set({ status: "sending", nextAttempt: new Date(Date.now() + 5 * 60_000), attempts: sql`${emailOutbox.attempts} + 1` }).where(inArray(emailOutbox.id, due.map((item) => item.id)));
    return due;
  });
  let sent = 0, failed = 0;
  for (const message of reserved) {
    try {
      if (message.sealedLink && message.createdAt.getTime() < Date.now() - (message.heading === "Reset your password" ? 30 : 1440) * 60_000) {
        await db.update(emailOutbox).set({ status: "failed", sealedLink: null, lastError: "Security link expired" }).where(eq(emailOutbox.id, message.id));
        failed++; continue;
      }
      const link = message.sealedLink ? unseal(message.sealedLink) : message.link;
      const text = [message.heading, ...Object.entries(message.fields).map(([key, val]) => `${key}: ${val}`), ...(link ? [link] : [])].join("\n");
      await transport.sendMail({ from: process.env.SMTP_FROM!, to: message.to, subject: message.subject, messageId: `<${message.id}@johnson-digital-empire>`, text, html: template(message.heading, message.fields, link, message.label) });
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), sealedLink: null, lastError: null }).where(eq(emailOutbox.id, message.id));
      sent++;
    } catch (error) {
      const attempts = message.attempts + 1;
      const terminal = attempts >= maxAttempts;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,24}$/.test(error.code) ? error.code : "DELIVERY_ERROR";
      await db.update(emailOutbox).set({ status: terminal ? "failed" : "pending", ...(terminal ? { sealedLink: null } : {}), lastError: code, nextAttempt: new Date(Date.now() + Math.min(360, 2 ** attempts) * 60_000) }).where(eq(emailOutbox.id, message.id));
      failed++;
    }
  }
  transport.close();
  return { sent, failed };
}
export function processOutbox(batch = 12) {
  if (current) { moreWork = true; return current; }
  current = (async () => {
    const total = { sent: 0, failed: 0 };
    for (let pass = 0; pass < 5; pass++) {
      moreWork = false;
      const batchResult = await drain(batch);
      total.sent += batchResult.sent;
      total.failed += batchResult.failed;
      if (!moreWork && batchResult.sent + batchResult.failed < batch) break;
    }
    return total;
  })().finally(() => { current = null; });
  return current;
}
export function triggerMail() {
  if (smtpReady()) after(async () => { try { await processOutbox(6); } catch { console.error("Background email delivery failed"); } });
}
export function recentMail() {
  return db.select({ id: emailOutbox.id, to: emailOutbox.to, subject: emailOutbox.subject, attempts: emailOutbox.attempts, status: emailOutbox.status, lastError: emailOutbox.lastError, createdAt: emailOutbox.createdAt }).from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(60);
}
