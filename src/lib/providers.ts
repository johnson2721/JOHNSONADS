import { createHmac, randomBytes, verify } from "node:crypto";
import type { Order, Payment } from "@/db/schema";
import { hostedLipwaLink, makeLipwaCheckout } from "./lipwa";
import { AppError, canonicalOrigin, sameSecret } from "./security";

export type Method = Payment["method"];
export type Option = { method: Method; amount: string; currency: string };
export type Check = { state: "confirmed"; reference: string; providerId?: string } | { state: "failed" } | { state: "pending" };
type ObjectMap = Record<string, unknown>;
export const obj = (value: unknown): ObjectMap => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectMap : {};
export const str = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const list = (value: unknown) => Array.isArray(value) ? value.map(obj) : [];
const auth = (key: string, secret: string) => "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
const configured = (...keys: string[]) => keys.every((key) => Boolean(process.env[key]));
const mpBase = () => process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
const ppBase = () => process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const binBase = "https://bpay.binanceapi.com";

function fx(amount: number, rate: string) {
  const num = Number(rate);
  if (!(num > 0 && num < 100_000)) return null;
  const cents = Math.round(amount / num * 100);
  return cents >= 1 ? (cents / 100).toFixed(2) : null;
}
export function paymentOptions(country: string, amount: number): Option[] {
  const origin = canonicalOrigin();
  const options: Option[] = [];
  if (hostedLipwaLink() && amount >= 10 && amount <= Number(process.env.LIPWA_ORDER_LIMIT_KES || 250_000)) options.push({ method: "lipwa", currency: "KES", amount: String(amount) });
  if (!origin?.startsWith("https://")) return options;
  if (configured("MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY") && (process.env.MPESA_CALLBACK_SECRET?.length ?? 0) >= 24 && amount <= Number(process.env.MPESA_ORDER_LIMIT_KES || 250_000)) options.push({ method: "mpesa", currency: "KES", amount: String(amount) });
  const pp = fx(amount, process.env.PAYPAL_KES_PER_USD || "");
  if (pp && configured("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET") && (process.env.PAYPAL_ENV !== "live" || process.env.PAYPAL_MERCHANT_ID)) options.push({ method: "paypal", currency: "USD", amount: pp });
  const bp = fx(amount, process.env.BINANCE_KES_PER_USDT || "");
  const allow = (process.env.BINANCE_PAY_COUNTRIES || "").toLowerCase().split(",").map((p) => p.trim());
  if (bp && process.env.BINANCE_PAY_ENABLED === "1" && allow.includes(country.toLowerCase()) && configured("BINANCE_PAY_KEY", "BINANCE_PAY_SECRET", "BINANCE_PAY_MERCHANT_ID")) options.push({ method: "binance", currency: "USDT", amount: bp });
  return options;
}
export function kenyaPhone(value: string) {
  const normalized = value.replace(/[+\s()-]/g, "").replace(/^0/, "254");
  if (!/^254[17]\d{8}$/.test(normalized)) throw new AppError(400, "Enter a Kenyan M-Pesa number, for example 0712 345 678.");
  return normalized;
}
export class ProviderError extends Error { constructor(public definitive: boolean, public code: string) { super("Payment provider request failed"); } }
async function request(url: string, init?: RequestInit) {
  let res: Response;
  try { res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12_000), cache: "no-store" }); }
  catch { throw new ProviderError(false, "NETWORK"); }
  const details = obj(await res.json().catch(() => null));
  if (!res.ok) throw new ProviderError(res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status), `HTTP_${res.status}`);
  if (!Object.keys(details).length) throw new ProviderError(false, "RESPONSE");
  return details;
}
function providerId(value: unknown) {
  const id = str(value);
  return /^[a-z\d_\-:.]{1,120}$/i.test(id) ? id : "";
}
const digits = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function darajaCredentials() {
  const Timestamp = digits.format(new Date()).replace(/\D/g, "");
  const BusinessShortCode = process.env.MPESA_SHORTCODE || "";
  return { BusinessShortCode, Timestamp, Password: Buffer.from(BusinessShortCode + process.env.MPESA_PASSKEY + Timestamp).toString("base64") };
}
async function daraja(path: string, body: ObjectMap) {
  const base = mpBase();
  let data: ObjectMap;
  try { data = await request(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: auth(process.env.MPESA_CONSUMER_KEY!, process.env.MPESA_CONSUMER_SECRET!) } }); }
  catch { throw new ProviderError(path.includes("processrequest"), "DARAJA_AUTH"); }
  if (!data.access_token) throw new ProviderError(path.includes("processrequest"), "DARAJA_AUTH");
  return request(base + path, { method: "POST", headers: { Authorization: `Bearer ${str(data.access_token)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function mpesaProof(id: string) { return createHmac("sha256", process.env.MPESA_CALLBACK_SECRET || "").update(id).digest("hex"); }
export function validMpesaProof(id: string, supplied: string) { return (process.env.MPESA_CALLBACK_SECRET?.length ?? 0) >= 24 && sameSecret(supplied, mpesaProof(id)); }
async function paypal(path: string, init?: RequestInit) {
  const base = ppBase();
  let data: ObjectMap;
  try { data = await request(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: auth(process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }); }
  catch { throw new ProviderError(true, "PAYPAL_AUTH"); }
  if (!data.access_token) throw new ProviderError(true, "PAYPAL_AUTH");
  return request(base + path, { ...init, headers: { Authorization: `Bearer ${str(data.access_token)}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
}
async function binance(path: string, values: ObjectMap) {
  const body = JSON.stringify(values);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha512", process.env.BINANCE_PAY_SECRET || "").update(`${timestamp}\n${nonce}\n${body}\n`).digest("hex").toUpperCase();
  return request(`${binBase}/binancepay/openapi/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "BinancePay-Timestamp": timestamp, "BinancePay-Nonce": nonce, "BinancePay-Signature": signature, "BinancePay-Certificate-SN": process.env.BINANCE_PAY_KEY || "" }, body });
}
function checkoutLink(value: unknown, domain: string) {
  try { const url = new URL(str(value)); return url.protocol === "https:" && !url.username && !url.password && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.toString() : null; } catch { return null; }
}
const tradeNo = (id: string) => id.replaceAll("-", "");
export async function startProvider(pay: Payment, order: Order) {
  if (pay.method === "lipwa") return makeLipwaCheckout(order);
  const origin = canonicalOrigin()!;
  if (pay.method === "mpesa") {
    const creds = darajaCredentials();
    const data = await daraja("/mpesa/stkpush/v1/processrequest", { ...creds, TransactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline", Amount: pay.amount, PartyA: Number(pay.phone), PartyB: process.env.MPESA_PARTY_B || creds.BusinessShortCode, PhoneNumber: Number(pay.phone), CallBackURL: `${origin}/api/webhooks/mpesa/${pay.id}/${mpesaProof(pay.id)}`, AccountReference: order.reference.replace(/^JDE-/, ""), TransactionDesc: "JDE checkout" });
    if (str(data.ResponseCode) !== "0") throw new ProviderError(Boolean(data.errorCode || data.ResponseCode !== undefined), "DARAJA_INIT");
    const id = providerId(data.CheckoutRequestID), requestId = providerId(data.MerchantRequestID);
    if (!id || !requestId) throw new ProviderError(false, "DARAJA_ID");
    return { providerId: id, providerRequest: requestId, checkoutUrl: null };
  }
  const returnUrl = `${origin}/checkout?order=${order.id}&returned=1`;
  const cancelUrl = `${origin}/checkout?order=${order.id}&cancelled=1`;
  if (pay.method === "paypal") {
    const data = await paypal("/v2/checkout/orders", { method: "POST", headers: { "PayPal-Request-Id": pay.id }, body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: order.reference, custom_id: order.reference, description: order.description.slice(0, 125), amount: { currency_code: pay.currency, value: pay.providerAmount } }], payment_source: { paypal: { experience_context: { brand_name: "Johnson Digital Empire", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: returnUrl, cancel_url: cancelUrl } } } }) });
    const link = checkoutLink(list(data.links).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href, "paypal.com");
    const id = providerId(data.id);
    if (!id || !link) throw new ProviderError(false, "PAYPAL_ID");
    return { providerId: id, providerRequest: null, checkoutUrl: link };
  }
  const result = await binance("v3/order", { env: { terminalType: "WEB" }, merchantTradeNo: tradeNo(pay.id), orderAmount: Number(pay.providerAmount), currency: pay.currency, description: order.description.slice(0, 100), goodsDetails: [{ goodsType: order.kind === "product" ? "01" : "02", goodsCategory: "D000", referenceGoodsId: order.reference, goodsName: "Johnson Digital Empire" }], returnUrl, cancelUrl, webhookUrl: `${origin}/api/webhooks/binance` });
  if (result.status !== "SUCCESS") throw new ProviderError(result.status === "FAIL", "BINANCE_INIT");
  const data = obj(result.data);
  const link = checkoutLink(data.checkoutUrl, "binance.com");
  const id = providerId(data.prepayId);
  if (!id || !link) throw new ProviderError(false, "BINANCE_ID");
  return { providerId: id, providerRequest: null, checkoutUrl: link };
}
export function mpesaCallback(raw: unknown) {
  const data = obj(obj(obj(raw).Body).stkCallback);
  const codeText = str(data.ResultCode), id = providerId(data.CheckoutRequestID), merchant = providerId(data.MerchantRequestID);
  if (!/^\d{1,8}$/.test(codeText) || !id || !merchant) throw new AppError(400, "Invalid Daraja callback.");
  const code = Number(codeText);
  const meta = Object.fromEntries(list(obj(data.CallbackMetadata).Item).map((item) => [str(item.Name), item.Value]));
  const amount = Number(meta.Amount), phone = str(meta.PhoneNumber), receipt = providerId(meta.MpesaReceiptNumber);
  if (code === 0 && (!Number.isSafeInteger(amount) || amount < 1 || !/^254[17]\d{8}$/.test(phone) || !receipt)) throw new AppError(400, "Incomplete Daraja confirmation.");
  return { id, callback: { merchant, receipt: code === 0 ? receipt : "", amount: code === 0 ? amount : 0, code, phone: code === 0 ? phone : "" } };
}
const sameAmount = (amount: unknown, expected: string) => /^\d+(?:\.\d{1,8})?$/.test(str(amount)) && Number(amount) === Number(expected);
export async function checkProvider(pay: Payment, order: Order, capture = false): Promise<Check> {
  if (!pay.providerId) return { state: "pending" };
  if (pay.method === "mpesa") {
    const callback = pay.callback;
    if (!callback || callback.merchant !== pay.providerRequest) return { state: "pending" };
    const data = await daraja("/mpesa/stkpushquery/v1/query", { ...darajaCredentials(), CheckoutRequestID: pay.providerId });
    if (str(data.CheckoutRequestID) !== pay.providerId || str(data.ResponseCode) !== "0" || (data.MerchantRequestID && str(data.MerchantRequestID) !== pay.providerRequest) || str(data.ResultCode) !== String(callback.code)) return { state: "pending" };
    if (callback.code !== 0) return { state: "failed" };
    if (callback.amount !== pay.amount || callback.phone !== pay.phone || !callback.receipt) throw new AppError(409, "The provider confirmation does not match this order.");
    return { state: "confirmed", reference: callback.receipt };
  }
  if (pay.method === "binance") {
    const result = await binance("v2/order/query", { merchantTradeNo: tradeNo(pay.id) });
    const data = obj(result.data);
    if (result.status !== "SUCCESS" || str(data.prepayId) !== pay.providerId || data.merchantTradeNo !== tradeNo(pay.id) || str(data.merchantId) !== process.env.BINANCE_PAY_MERCHANT_ID || data.currency !== pay.currency || !sameAmount(data.orderAmount, pay.providerAmount)) throw new AppError(409, "The provider confirmation does not match this order.");
    if (["ERROR", "CANCELED", "EXPIRED"].includes(str(data.status))) return { state: "failed" };
    const reference = providerId(data.transactionId);
    return data.status === "PAID" && reference ? { state: "confirmed", reference } : { state: "pending" };
  }
  const path = `/v2/checkout/orders/${encodeURIComponent(pay.providerId)}`;
  let data = await paypal(path);
  const checkUnit = (record: ObjectMap) => {
    const unit = list(record.purchase_units)[0];
    const amount = obj(unit?.amount);
    if (str(record.id) !== pay.providerId || !unit || (unit.custom_id !== order.reference && unit.reference_id !== order.reference) || amount.currency_code !== pay.currency || !sameAmount(amount.value, pay.providerAmount) || (process.env.PAYPAL_MERCHANT_ID && obj(unit.payee).merchant_id !== process.env.PAYPAL_MERCHANT_ID)) throw new AppError(409, "The provider confirmation does not match this order.");
    return unit;
  };
  let unit = checkUnit(data);
  if (data.status === "APPROVED" && capture) {
    try { await paypal(path + "/capture", { method: "POST", headers: { "PayPal-Request-Id": `capture-${pay.id}` }, body: "{}" }); }
    catch (error) { if (!(error instanceof ProviderError) || !error.definitive) throw error; }
    data = await paypal(path); unit = checkUnit(data);
  }
  const captures = list(obj(unit.payments).captures);
  if (data.status === "VOIDED" || captures.some((p) => p.status === "DECLINED" || p.status === "FAILED")) return { state: "failed" };
  const settled = captures.find((p) => p.status === "COMPLETED" && obj(p.amount).currency_code === pay.currency && sameAmount(obj(p.amount).value, pay.providerAmount));
  const reference = providerId(settled?.id);
  return data.status === "COMPLETED" && reference ? { state: "confirmed", reference } : { state: "pending" };
}
export async function paypalWebhook(req: Request, event: unknown) {
  if (!process.env.PAYPAL_WEBHOOK_ID) return false;
  const read = (key: string) => req.headers.get(`paypal-${key}`)?.slice(0, 1200);
  const fields = { auth_algo: read("auth-algo"), cert_url: read("cert-url"), transmission_id: read("transmission-id"), transmission_sig: read("transmission-sig"), transmission_time: read("transmission-time") };
  if (Object.values(fields).some((value) => !value)) return false;
  return (await paypal("/v1/notifications/verify-webhook-signature", { method: "POST", body: JSON.stringify({ ...fields, webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: event }) })).verification_status === "SUCCESS";
}
export function binanceWebhook(req: Request, raw: string) {
  const timestamp = req.headers.get("binancepay-timestamp") || "";
  const nonce = req.headers.get("binancepay-nonce") || "";
  const signature = req.headers.get("binancepay-signature") || "";
  const sn = req.headers.get("binancepay-certificate-sn");
  const publicKey = process.env.BINANCE_WEBHOOK_PUBLIC_KEY?.replaceAll("\\n", "\n");
  if (!publicKey || !sn || sn !== process.env.BINANCE_WEBHOOK_CERT_SN || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 600_000 || !/^[\w-]{1,80}$/.test(nonce) || !/^[A-Za-z\d+/=]{40,1200}$/.test(signature)) return false;
  return verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), publicKey, Buffer.from(signature, "base64"));
}
export async function paypalRefund(pay: Payment, refundId: string, previous?: string | null) {
  if (!pay.externalRef) throw new AppError(409, "No capture reference is available for this payment.");
  const capturePath = `/v2/payments/captures/${encodeURIComponent(pay.externalRef)}`;
  const data = previous ? await paypal(`/v2/payments/refunds/${encodeURIComponent(previous)}`) : await paypal(capturePath + "/refund", { method: "POST", headers: { "PayPal-Request-Id": refundId }, body: JSON.stringify({ amount: { value: pay.providerAmount, currency_code: pay.currency } }) });
  const id = providerId(data.id), amount = obj(data.amount);
  if (!id || amount.currency_code !== pay.currency || !sameAmount(amount.value, pay.providerAmount) || (previous && previous !== id)) throw new AppError(409, "The refund details did not match the payment.");
  return { status: str(data.status), id };
}
