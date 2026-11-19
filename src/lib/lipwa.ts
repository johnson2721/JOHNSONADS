import type { Order, Payment } from "@/db/schema";
import { AppError, canonicalOrigin } from "./security";

export const LIPWA_LINK = "https://lipwa.link/10283";
const statusApi = "https://backend.payhero.co.ke/api/v2";
const ref = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
const obj = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function lipwaVerificationReady() {
  return !!(process.env.LIPWA_PAYHERO_API_USERNAME && process.env.LIPWA_PAYHERO_API_PASSWORD);
}
export function hostedLipwaLink() {
  if (process.env.LIPWA_ENABLED === "0") return null;
  try {
    const url = new URL(process.env.LIPWA_PAYMENT_URL || LIPWA_LINK);
    if (url.origin === "https://lipwa.link" && /^\/\d{1,18}\/?$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password) return url;
  } catch {}
  return null;
}
export function makeLipwaCheckout(order: Order) {
  const url = hostedLipwaLink();
  if (!url) throw new AppError(503, "The Lipwa payment link is not currently available.");
  url.searchParams.set("amount", String(order.amount));
  url.searchParams.set("reference", order.reference);
  const origin = canonicalOrigin();
  if (origin?.startsWith("https://")) {
    const returnTo = `${origin}/checkout?order=${order.id}`;
    url.searchParams.set("success_url", `${returnTo}&returned=1`);
    url.searchParams.set("failed_url", `${returnTo}&cancelled=1`);
  }
  return { providerId: null, providerRequest: order.reference, checkoutUrl: url.toString() };
}
export function parseLipwaReference(value: string) {
  const clean = value.trim();
  if (/^[A-Z0-9]{10}$/i.test(clean)) return clean.toUpperCase();
  if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(clean) || /^ws_CO_[\d]{10,40}$/i.test(clean) || /^TR_[\da-z]{8,20}$/i.test(clean)) return clean;
  throw new AppError(400, "Enter the M-Pesa transaction code or the payment reference shown by Lipwa, not a PIN or order number.");
}
async function payHero(path: string, params: Record<string, string>) {
  const credentials = Buffer.from(`${process.env.LIPWA_PAYHERO_API_USERNAME}:${process.env.LIPWA_PAYHERO_API_PASSWORD}`).toString("base64");
  const url = `${statusApi}/${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try { res = await fetch(url, { headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" }, signal: AbortSignal.timeout(9500), redirect: "error", cache: "no-store" }); }
  catch { throw new AppError(503, "Lipwa couldn’t be reached. Your order is still awaiting confirmation."); }
  if (res.status === 404) return {};
  if (!res.ok) throw new AppError(503, "Lipwa verification is temporarily unavailable. Please try again later.");
  return obj(await res.json().catch(() => null));
}
function record(value: unknown) {
  const data = obj(value);
  const extra = obj(data.response ?? data.data ?? data.transaction);
  const mercury = { ...data, ...extra, ...obj(extra.transaction) };
  const fields = (keys: string[]) => keys.map((key) => ref(mercury[key])).find(Boolean) || "";
  return {
    id: fields(["transaction_reference", "reference", "CheckoutRequestID", "checkout_request_id", "transaction_id"]),
    receipt: fields(["provider_reference", "MpesaReceiptNumber", "mpesa_receipt_number", "receipt", "receipt_number"]),
    order: fields(["external_reference", "ExternalReference", "merchant_reference", "user_reference", "api_ref"]),
    status: fields(["status", "payment_status", "transaction_status"]).toUpperCase(),
    amount: fields(["amount", "Amount", "transaction_amount"]),
    currency: fields(["currency", "currency_code"]).toUpperCase(),
    provider: fields(["provider", "payment_provider"]).toLowerCase(),
    type: fields(["transaction_type", "type"]).toLowerCase(),
  };
}
const isSuccess = (state: string) => ["SUCCESS", "COMPLETED", "PAYMENT.SUCCESS"].includes(state);
const keyMatch = (a: string, b: string) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
const validKes = (value: string, amount: number) => /^\d+(?:\.\d{1,4})?$/.test(value) && Number(value) === amount;
export async function checkLipwa(pay: Payment, order: Order, hint: string) {
  if (!lipwaVerificationReady()) return null;
  if (pay.method !== "lipwa" || pay.providerRequest !== order.reference || pay.currency !== "KES" || pay.amount !== order.amount) throw new AppError(409, "This Lipwa attempt does not match the order.");
  const status = record(await payHero("transaction-status", { reference: hint }));
  if (!isSuccess(status.status)) return null;
  if (!keyMatch(status.id, hint) && !keyMatch(status.receipt, hint)) throw new AppError(409, "Lipwa did not return the requested transaction. Check the payment reference.");
  if (status.order && status.order !== order.reference) throw new AppError(409, "This Lipwa payment is associated with a different order.");
  let ledger: ReturnType<typeof record> | undefined;
  if (!status.order || !status.amount || !status.receipt) {
    for (const page of [1, 2]) {
      const result = await payHero("transactions", { page: String(page), per_page: "50" });
      const data = obj(result.data);
      const entries = [result.transactions, data.transactions, data.data, result.data].find(Array.isArray) || [];
      ledger = entries.map(record).find((row) => keyMatch(row.id, status.id) || keyMatch(row.receipt, status.receipt) || keyMatch(row.id, hint) || keyMatch(row.receipt, hint));
      if (ledger || !entries.length) break;
    }
  }
  const receipt = status.receipt || ledger?.receipt || "";
  const providerId = status.id || ledger?.id || receipt;
  const paidAmount = status.amount || ledger?.amount || "";
  const reference = status.order || ledger?.order || "";
  if (!reference || !paidAmount || !receipt) return null;
  if (reference !== order.reference || !validKes(paidAmount, order.amount) || [status.currency, ledger?.currency].some((currency) => currency && currency !== "KES") || (ledger?.order && ledger.order !== order.reference) || (ledger?.amount && !validKes(ledger.amount, order.amount)) || [status.type, ledger?.type].some((type) => type && /withdraw|refund|debit|outgoing|reversal/.test(type))) throw new AppError(409, "Lipwa’s payment details do not match this order and amount.");
  // Without an explicit currency, accept only an actual M-Pesa receipt or declared M-Pesa provider.
  const mpesaReceipt = /^[A-Z\d]{10}$/i.test(receipt);
  const explicitlyKes = status.currency === "KES" || ledger?.currency === "KES" || [status.provider, ledger?.provider].some((name) => name === "m-pesa" || name === "mpesa");
  if (!/^[a-z\d_:.\-]{4,120}$/i.test(receipt) || !/^[a-z\d_:.\-]{4,120}$/i.test(providerId) || (!mpesaReceipt && !explicitlyKes)) return null;
  return { state: "confirmed" as const, reference: receipt.toUpperCase(), providerId };
}
