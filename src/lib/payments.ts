import { and, asc, desc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { listings, orders, payments, refunds, subscriptions, users, type Order, type Payment, type User } from "@/db/schema";
import { METHOD_LABELS, dateLabel, money } from "./catalog";
import { cleanString, lockUser } from "./marketplace";
import { checkLipwa, lipwaVerificationReady, parseLipwaReference } from "./lipwa";
import { queueCustomerMail, recordEvent, triggerMail } from "./mail";
import { checkProvider, kenyaPhone, mpesaCallback, obj, paypalRefund, paymentOptions, ProviderError, startProvider, str, type Check } from "./providers";
import { publicCondition } from "./public-data";
import { AppError, canonicalOrigin, UUID } from "./security";

function simplify(pay: Payment) { return { id: pay.id, method: pay.method, amount: pay.amount, providerAmount: pay.providerAmount, currency: pay.currency, status: pay.status, checkoutUrl: pay.checkoutUrl, receipt: pay.receipt, verificationHint: pay.verificationHint }; }
export async function ownedOrder(user: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Order not found.");
  const [order] = await db.select().from(orders).where(and(eq(orders.userId, user.id), eq(orders.id, id)));
  if (!order) throw new AppError(404, "Order not found.");
  return order;
}
export async function checkoutData(user: User, id: string) {
  const order = await ownedOrder(user, id);
  const [pay] = await db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.createdAt)).limit(1);
  return { order, payment: pay ? simplify(pay) : null, options: paymentOptions(user.country, order.amount), lipwaVerification: lipwaVerificationReady() };
}

async function finalize(pay: Payment, outcome: Check) {
  if (outcome.state === "pending") return pay;
  const [known] = await db.select().from(orders).where(eq(orders.id, pay.orderId));
  if (!known) return pay;
  const result = await db.transaction(async (tx) => {
    await lockUser(tx, known.userId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, pay.orderId)).for("update");
    const [payment] = await tx.select().from(payments).where(eq(payments.id, pay.id)).for("update");
    if (!payment || payment.status !== "pending" || order.status !== "processing") return payment ?? pay;
    const [actor] = await tx.select().from(users).where(eq(users.id, order.userId));
    const now = new Date();
    if (outcome.state === "failed") {
      const [failed] = await tx.update(payments).set({ status: "failed", callback: null, checkoutUrl: null, phone: null }).where(eq(payments.id, pay.id)).returning();
      await tx.update(orders).set({ status: "awaiting_payment" }).where(eq(orders.id, order.id));
      await recordEvent(tx, { type: "Failed payment", actor, reference: payment.providerId ? `${order.reference} · ${payment.providerId}` : order.reference, paymentStatus: "Failed", dashboard: "/admin#payments" });
      return failed;
    }
    if (["mpesa", "lipwa"].includes(payment.method)) {
      const reference = outcome.reference.toUpperCase();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'jde-mobile:'} || ${reference}, 0))`);
      const [claimed] = await tx.select({ id: payments.id }).from(payments).where(and(inArray(payments.method, ["mpesa", "lipwa"]), sql`upper(${payments.externalRef}) = ${reference}`, sql`${payments.id} <> ${payment.id}`)).limit(1);
      if (claimed) throw new AppError(409, "This receipt is already linked to a confirmed order.");
    }
    const receipt = `JDE-R-${payment.id.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const [confirmed] = await tx.update(payments).set({ status: "confirmed", externalRef: outcome.reference, providerId: outcome.providerId || payment.providerId, verificationHint: null, receipt, confirmedAt: now, callback: null, checkoutUrl: null, phone: null }).where(eq(payments.id, pay.id)).returning();
    await tx.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id));
    if (order.packageSlug && order.packageDays && order.packageSlots) {
      const [previous] = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, order.userId), eq(subscriptions.packageSlug, order.packageSlug)));
      const expiry = new Date(Math.max(previous?.endsAt.getTime() ?? 0, now.getTime()) + order.packageDays * 86_400_000);
      await tx.insert(subscriptions).values({ userId: order.userId, packageSlug: order.packageSlug, lastOrderId: order.id, startsAt: now, endsAt: expiry, slots: order.packageSlots }).onConflictDoUpdate({ target: [subscriptions.userId, subscriptions.packageSlug], set: { lastOrderId: order.id, endsAt: expiry, slots: order.packageSlots } });
      if (previous && previous.endsAt > now && previous.slots === order.packageSlots) {
        await tx.update(listings).set({ promotedUntil: expiry }).where(and(eq(listings.ownerId, order.userId), eq(listings.promotedUntil, previous.endsAt)));
      }
      await recordEvent(tx, { type: order.kind === "advertising" ? "Advertising package activated" : previous ? "Subscription renewal" : "Subscription purchase", actor, reference: order.reference, paymentStatus: "Confirmed", dashboard: "/admin#payments" });
    }
    await recordEvent(tx, { type: "Successful payment", actor, reference: `${order.reference} · ${outcome.reference}`, paymentStatus: "Confirmed", dashboard: "/admin#payments" });
    const origin = canonicalOrigin();
    if (actor) await queueCustomerMail(tx, { to: actor.email, heading: "Payment confirmed", fields: { Receipt: receipt, Order: order.reference, Transaction: outcome.reference, Item: order.description, Amount: money(pay.amount), Method: METHOD_LABELS[pay.method] }, link: origin ? `${origin}/checkout?order=${order.id}` : undefined, label: "View payment receipt" });
    return confirmed;
  });
  return result;
}
export async function beginPayment(user: User, raw: unknown) {
  const input = z.object({ orderId: z.uuid(), method: z.enum(["mpesa", "paypal", "binance", "lipwa"]), phone: z.string().max(30).optional(), amount: z.string().max(30), currency: z.string().max(8) }).parse(raw);
  const state = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.userId, user.id))).for("update");
    if (!order) throw new AppError(404, "Order not found.");
    if (!["awaiting_payment", "processing"].includes(order.status)) throw new AppError(409, "This order is no longer awaiting payment.");
    const [existing] = await tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")));
    if (existing) return { order, pay: existing, created: false };
    if (order.listingId && order.kind === "product") {
      const [item] = await tx.select({ id: listings.id }).from(listings).where(and(eq(listings.id, order.listingId), publicCondition()));
      if (!item) throw new AppError(409, "This item is no longer available to purchase.");
    }
    const option = paymentOptions(user.country, order.amount).find((p) => p.method === input.method);
    if (!option) throw new AppError(503, "This payment method is currently unavailable.");
    if (input.amount !== option.amount || input.currency !== option.currency) throw new AppError(409, "The checkout amount changed. Refresh and review the total before paying.");
    const phone = input.method === "mpesa" ? kenyaPhone(input.phone ?? "") : null;
    const [pay] = await tx.insert(payments).values({ orderId: order.id, method: input.method, amount: order.amount, providerAmount: option.amount, currency: option.currency, phone }).returning();
    if (input.method === "lipwa") await recordEvent(tx, { type: "Lipwa checkout opened", actor: user, reference: order.reference, paymentStatus: "Pending verification", admin: false });
    await tx.update(orders).set({ status: "processing" }).where(eq(orders.id, order.id));
    return { order, pay, created: true };
  });
  if (!state.created) return simplify(state.pay);
  try {
    const provider = await startProvider(state.pay, state.order);
    const [pay] = await db.update(payments).set(provider).where(eq(payments.id, state.pay.id)).returning();
    return simplify(pay);
  } catch (error) {
    if (error instanceof ProviderError && error.definitive) {
      await finalize(state.pay, { state: "failed" });
      triggerMail();
      throw new AppError(502, "The provider did not accept this payment. You can try again or choose another method.");
    }
    console.error("Payment initiation requires reconciliation", state.pay.id, error instanceof ProviderError ? error.code : "UNEXPECTED");
    return simplify(state.pay);
  }
}
async function reconcile(pay: Payment, capture = false) {
  if (pay.status !== "pending") return pay;
  const [order] = await db.select().from(orders).where(eq(orders.id, pay.orderId));
  if (!order) return pay;
  if (pay.method === "lipwa") {
    if (!pay.verificationHint) return pay;
    const checked = await checkLipwa(pay, order, pay.verificationHint);
    if (!checked) return pay;
    const [used] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.method, "lipwa"), eq(payments.externalRef, checked.reference))).limit(1);
    if (used && used.id !== pay.id) throw new AppError(409, "That payment has already been reconciled to an order.");
    return finalize(pay, checked);
  }
  return finalize(pay, await checkProvider(pay, order, capture));
}
export async function checkPayment(user: User, id: string, raw?: unknown) {
  if (!UUID.test(id)) throw new AppError(404, "Payment not found.");
  const [row] = await db.select({ pay: payments }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(and(eq(payments.id, id), eq(orders.userId, user.id)));
  if (!row) throw new AppError(404, "Payment not found.");
  let attempt = row.pay;
  if (raw !== undefined && attempt.method === "lipwa" && attempt.status === "pending") {
    const { reference } = z.object({ reference: z.string().trim().min(4).max(120) }).parse(raw);
    const hint = parseLipwaReference(reference);
    if (hint !== attempt.verificationHint) {
      const updated = await db.transaction(async (tx) => {
        const [next] = await tx.update(payments).set({ verificationHint: hint }).where(and(eq(payments.id, attempt.id), eq(payments.status, "pending"), sql`${payments.verificationHint} is distinct from ${hint}`)).returning();
        if (next) await recordEvent(tx, { type: "Lipwa payment reference submitted", actor: user, reference: `${row.pay.providerRequest || row.pay.orderId} · ${hint}`, paymentStatus: "Awaiting provider confirmation", dashboard: "/admin#payments" });
        return next;
      });
      if (updated) { attempt = updated; triggerMail(); }
    }
  }
  try { const pay = await reconcile(attempt, true); triggerMail(); return simplify(pay); }
  catch (error) { if (error instanceof ProviderError) throw new AppError(502, "The payment provider did not respond. Your order is still pending."); throw error; }
}
export async function checkLipwaAdmin(admin: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Lipwa payment not found.");
  const [pay] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.method, "lipwa")));
  if (!pay) throw new AppError(404, "Lipwa payment not found.");
  if (!lipwaVerificationReady()) throw new AppError(503, "Set the Pay Hero merchant API credentials to verify Lipwa payments.");
  if (!pay.verificationHint && pay.status === "pending") throw new AppError(409, "The customer has not entered a Lipwa payment reference yet.");
  const updated = await reconcile(pay);
  await db.transaction(async (tx) => { await recordEvent(tx, { actor: admin, type: "Admin checked Lipwa payment status", reference: id, detail: updated.status, admin: false }); });
  triggerMail();
  return simplify(updated);
}
export async function receiveMpesa(id: string, raw: unknown) {
  const parsed = mpesaCallback(raw);
  const [pay] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.method, "mpesa")));
  if (!pay) throw new AppError(404, "Payment not found.");
  if (!pay.providerId) throw new AppError(503, "Daraja initialization is not yet recorded.");
  if (pay.providerId !== parsed.id || pay.providerRequest !== parsed.callback.merchant) throw new AppError(400, "Daraja identifiers do not match this payment.");
  if (pay.status !== "pending") return { ResultCode: 0, ResultDesc: "Acknowledged" };
  if (parsed.callback.code === 0 && (parsed.callback.amount !== pay.amount || parsed.callback.phone !== pay.phone)) throw new AppError(400, "Daraja callback amount or account mismatch.");
  const [updated] = await db.update(payments).set({ callback: parsed.callback }).where(and(eq(payments.id, id), eq(payments.status, "pending"))).returning();
  if (updated) { try { await reconcile(updated); } catch { console.error("Daraja verification delayed", id); } }
  triggerMail();
  return { ResultCode: 0, ResultDesc: "Acknowledged" };
}
export async function receivePayPal(raw: unknown) {
  const data = obj(raw), event = str(data.event_type), resource = obj(data.resource);
  const id = event === "CHECKOUT.ORDER.APPROVED" ? str(resource.id) : ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.PENDING"].includes(event) ? str(obj(obj(resource.supplementary_data).related_ids).order_id) : "";
  if (!id) return { ok: true };
  const [pay] = await db.select().from(payments).where(and(eq(payments.method, "paypal"), eq(payments.providerId, id), eq(payments.status, "pending")));
  if (pay) { await reconcile(pay, event === "CHECKOUT.ORDER.APPROVED"); triggerMail(); }
  return { ok: true };
}
export async function receiveBinance(raw: unknown) {
  const event = obj(raw);
  if (event.bizType !== "PAY") return;
  let data: ReturnType<typeof obj>;
  try { data = obj(JSON.parse(str(event.data))); } catch { throw new AppError(400, "Invalid Binance callback."); }
  const id = str(data.merchantTradeNo).replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, "$1-$2-$3-$4-$5");
  if (!UUID.test(id)) throw new AppError(400, "Invalid Binance order reference.");
  const [pay] = await db.select().from(payments).where(and(eq(payments.method, "binance"), eq(payments.id, id), eq(payments.status, "pending")));
  if (pay) { await reconcile(pay); triggerMail(); }
}
export async function reconcilePending() {
  const pending = await db.select().from(payments).where(and(eq(payments.status, "pending"), gt(payments.createdAt, new Date(Date.now() - 3 * 86400_000)), or(and(isNotNull(payments.providerId), or(and(eq(payments.method, "mpesa"), isNotNull(payments.callback)), inArray(payments.method, ["paypal", "binance"]))), lipwaVerificationReady() ? and(eq(payments.method, "lipwa"), isNotNull(payments.verificationHint)) : undefined))).orderBy(desc(payments.createdAt)).limit(30);
  for (let i = 0; i < pending.length; i += 5) await Promise.all(pending.slice(i, i + 5).map(async (payment) => { try { await reconcile(payment, true); } catch { console.error("Provider check deferred", payment.id); } }));
  return pending.length;
}
export async function cancelOrder(user: User, id: string) {
  const order = await ownedOrder(user, id);
  const [cancelled] = await db.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, order.id), eq(orders.status, "awaiting_payment"))).returning();
  if (!cancelled) throw new AppError(409, "Only unpaid orders without an active payment can be cancelled.");
  await db.transaction(async (tx) => { await recordEvent(tx, { type: "Order cancelled", actor: user, reference: order.reference, detail: order.description, admin: false }); });
  return { ok: true };
}
export async function receiptFile(user: User, id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Receipt not found.");
  const [row] = await db.select({ payment: payments, order: orders, holder: users.name }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).innerJoin(users, eq(users.id, orders.userId)).where(and(eq(payments.id, id), inArray(payments.status, ["confirmed", "refunded"]), user.role === "admin" ? undefined : eq(orders.userId, user.id)));
  if (!row?.payment.receipt) throw new AppError(404, "Receipt not found.");
  const { payment, order, holder } = row;
  const text = ["JOHNSON DIGITAL EMPIRE", "PAYMENT RECEIPT", "", `Receipt: ${payment.receipt}`, `Order: ${order.reference}`, `Customer: ${holder}`, `Purchased: ${order.description}`, `Amount: ${money(payment.amount)}`, `Charged by provider: ${payment.currency} ${payment.providerAmount}`, `Payment method: ${METHOD_LABELS[payment.method]}`, `Transaction: ${payment.externalRef}`, `Payment date: ${dateLabel(payment.confirmedAt || payment.createdAt)}`, `Status: ${payment.status.toUpperCase()}`].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${payment.receipt}.txt"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function manageRefund(admin: User, id: string, raw: unknown) {
  if (!UUID.test(id)) throw new AppError(404, "Refund request not found.");
  const input = z.object({ decision: z.enum(["approve", "reject", "settle"]), note: cleanString(3, 500, "Decision notes"), reference: z.string().trim().regex(/^[a-z\d_-]{4,100}$/i).optional() }).parse(raw);
  const [row] = await db.select({ refund: refunds, order: orders, pay: payments }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "confirmed"))).where(eq(refunds.id, id));
  if (!row) throw new AppError(404, "Confirmed refund request not found.");
  const { refund, order, pay } = row;
  let reference = input.reference ?? null;
  if (input.decision === "settle") {
    if (refund.status !== "approved") throw new AppError(409, "Approve the request before settling it.");
    if (pay.method === "paypal") {
      let checked;
      try { checked = await paypalRefund(pay, refund.id, refund.reference); }
      catch (err) { if (err instanceof ProviderError) throw new AppError(502, "PayPal did not confirm the refund. Check the provider dashboard, then try again."); throw err; }
      reference = checked.id;
      if (checked.status !== "COMPLETED") {
        await db.update(refunds).set({ reference }).where(and(eq(refunds.id, id), eq(refunds.status, "approved")));
        throw new AppError(409, "PayPal has not completed this refund. Check again later.");
      }
    }
    if (!reference) throw new AppError(400, "Enter the completed reversal reference from the provider portal.");
  }
  const result = await db.transaction(async (tx) => {
    await lockUser(tx, order.userId);
    const [locked] = await tx.select().from(refunds).where(eq(refunds.id, id)).for("update");
    const next = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "refunded";
    if (!locked || (next === "refunded" ? locked.status !== "approved" : locked.status !== "requested")) throw new AppError(409, "This request was already reviewed.");
    await tx.update(refunds).set({ status: next, decision: input.note, reference, resolvedAt: new Date() }).where(eq(refunds.id, id));
    if (next === "refunded") {
      await tx.update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));
      await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, pay.id));
      if (order.packageSlug && order.packageDays) {
        const now = new Date();
        await tx.update(subscriptions).set({ endsAt: sql`greatest(now(), ${subscriptions.endsAt} - (${order.packageDays} * interval '1 day'))` }).where(and(eq(subscriptions.userId, order.userId), eq(subscriptions.packageSlug, order.packageSlug), gt(subscriptions.endsAt, now)));
        const [latest] = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, order.userId), gt(subscriptions.endsAt, now))).orderBy(desc(subscriptions.endsAt), asc(subscriptions.slots)).limit(1);
        await tx.update(listings).set({ promotedUntil: latest ? sql`least(${listings.promotedUntil}, ${latest.endsAt})` : null }).where(and(eq(listings.ownerId, order.userId), gt(listings.promotedUntil, now)));
      }
    }
    const [customer] = await tx.select().from(users).where(eq(users.id, order.userId));
    if (customer) await queueCustomerMail(tx, { to: customer.email, heading: "Refund request updated", fields: { Order: order.reference, Status: next, Message: input.note, ...(reference ? { Reference: reference } : {}) } });
    await recordEvent(tx, { type: `Refund ${next}`, userId: order.userId, reference: order.reference, detail: order.description, admin: false });
    await recordEvent(tx, { type: `Admin: refund ${next}`, actor: admin, reference: order.reference, admin: false });
    return { ok: true, status: next };
  });
  triggerMail();
  return result;
}
