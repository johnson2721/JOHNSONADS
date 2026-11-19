"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Clock3, CreditCard, Download, Info, LockKeyhole, RefreshCw, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { api, errorText, field } from "@/lib/client";
import { METHOD_LABELS, money } from "@/lib/catalog";
import type { Option } from "@/lib/providers";
import type { checkoutData } from "@/lib/payments";
import { LipwaPending } from "./lipwa-checkout";

type Data = Awaited<ReturnType<typeof checkoutData>>;
type Target = { kind: "plan" | "product"; slug: string; name: string; price: number };
export function CheckoutPanel({ target, data, verified, phone, returned, cancelled }: { target?: Target; data?: Data; verified: boolean; phone: string; returned?: boolean; cancelled?: boolean }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(data?.payment);
  const [method, setMethod] = useState<Option["method"] | undefined>(data?.options[0]?.method);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [verification, setVerification] = useState("");
  const option = data?.options.find((value) => value.method === method);
  const paymentId = attempt?.id;
  const pending = attempt?.status === "pending";
  useEffect(() => {
    if (!paymentId || !pending || (!returned && attempt?.method !== "mpesa")) return;
    let remaining = 7; let live = true;
    const check = async () => {
      try { const next = await api<NonNullable<Data["payment"]>>(`/api/payments/${paymentId}/check`, "POST"); if (live) setAttempt(next); } catch {}
    };
    if (returned) void check();
    const id = setInterval(() => { if (--remaining < 0) { clearInterval(id); return; } void check(); }, 6500);
    return () => { live = false; clearInterval(id); };
  }, [paymentId, pending, returned, attempt?.method]);
  const confirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (target) {
        const order = await api<{ id: string }>("/api/orders", "POST", { kind: target.kind, slug: target.slug });
        router.replace(`/checkout?order=${order.id}`);
        return;
      }
      if (!data || !option) return;
      const values = new FormData(e.currentTarget);
      const result = await api<NonNullable<Data["payment"]>>("/api/payments", "POST", { orderId: data.order.id, ...option, phone: field(values, "phone") || undefined });
      setAttempt(result);
      if (result.checkoutUrl && result.method !== "lipwa") window.location.assign(result.checkoutUrl);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const check = async (reference?: string) => {
    if (!paymentId) return;
    setBusy(true); setError(""); setVerification("");
    try {
      const updated = await api<NonNullable<Data["payment"]>>(`/api/payments/${paymentId}/check`, "POST", reference ? { reference } : undefined);
      setAttempt(updated);
      if (reference && updated.status === "pending") setVerification(data?.lipwaVerification ? "Reference saved. Lipwa has not confirmed this payment yet. If you already paid, please don’t pay again." : "Reference saved. Your order stays pending until Lipwa verification is connected.");
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const cancel = async () => { if (!data) return; setBusy(true); setError(""); try { await api(`/api/orders/${data.order.id}/cancel`, "POST"); router.push("/dashboard?tab=orders"); router.refresh(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } };
  const status = attempt?.status === "refunded" || data?.order.status === "refunded" ? "Refunded" : attempt?.status === "confirmed" || data?.order.status === "paid" || data?.order.status === "completed" ? "Confirmed" : data?.order.status === "cancelled" ? "Cancelled" : null;
  const canPay = !!data && !!option && verified && !status && !pending;
  return <div className="checkout-grid">
    <section className="panel"><h2>{target ? "Review your order" : "Payment details"}</h2>
      {target && <form onSubmit={confirm} className="form-stack"><p className="sub-copy">Create the order first. You’ll review the payment method and the exact amount before being charged.</p><button className="button button-gold align-start" type="submit" disabled={busy}>{busy ? "Creating order…" : "Create order"}<ArrowRight size={17}/></button></form>}
      {status && <div className={`notice ${status === "Confirmed" ? "notice-success" : ""}`}><CheckCircle2 size={22}/><div><strong>{status === "Confirmed" ? "Payment confirmed" : `Order ${status.toLowerCase()}`}</strong><p>{status === "Confirmed" ? "Your payment has been verified by the provider." : "View the order and related activity in your dashboard."}</p>{attempt?.receipt && <a className="text-link" href={`/api/receipts/${attempt.id}`}><Download size={16}/> Download your receipt</a>}</div></div>}
      {!status && pending && attempt?.method === "lipwa" && data && <LipwaPending url={attempt.checkoutUrl} amount={attempt.amount} order={data.order.reference} reference={attempt.verificationHint} ready={data.lipwaVerification} busy={busy} onCheck={(reference) => void check(reference)}/>}
      {!status && pending && attempt?.method !== "lipwa" && <div className="pending-payment"><div className="notice"><Clock3 size={22}/><div><strong>Waiting for payment confirmation</strong><p>{attempt?.method === "mpesa" ? "If you received the M-Pesa prompt, complete it on your phone. We’ll check for the official confirmation." : cancelled ? "You left the provider checkout. You can return to it or check the current status here." : "Complete your payment on the provider’s site. A browser return alone does not confirm payment."}</p></div></div><div className="button-row">{attempt?.checkoutUrl && <a className="button button-gold" href={attempt.checkoutUrl}>Continue to {METHOD_LABELS[attempt.method]} <ArrowRight size={16}/></a>}<button type="button" className="button button-outline" onClick={() => void check()} disabled={busy}><RefreshCw size={16}/>{busy ? "Checking…" : "Check payment status"}</button></div></div>}
      {data && !status && !pending && <>
        {!verified && <div className="notice"><Info size={19}/><div><strong>Verify your email before paying</strong><p>Open your dashboard to resend the verification link if you need it.</p><Link href="/dashboard" className="text-link">Open dashboard <ArrowRight size={16}/></Link></div></div>}
        {!data.options.length && <div className="notice"><Info size={19}/><div><strong>No payment provider is available for this order</strong><p>Your order is saved. You won’t be charged until a configured provider confirms payment.</p><Link href="/contact?type=support" className="text-link">Contact support <ArrowRight size={16}/></Link></div></div>}
        {attempt?.status === "failed" && <p className="form-error" role="status">The previous payment was not completed. You can try again.</p>}
        {data.options.length > 0 && <form className="form-stack" onSubmit={confirm}><fieldset className="payment-options"><legend>Select a payment method</legend>{data.options.map((item) => { const Icon = item.method === "mpesa" ? Smartphone : item.method === "paypal" ? CreditCard : Wallet; return <label key={item.method} className={method === item.method ? "selected" : ""}><input type="radio" name="method" checked={method === item.method} onChange={() => setMethod(item.method)}/><Icon size={19}/><span>{METHOD_LABELS[item.method]}{item.method === "lipwa" && <small className="method-note">Hosted checkout · KES</small>}</span><strong>{item.currency} {item.amount}</strong></label>; })}</fieldset>{method === "mpesa" && <label>M-Pesa phone number<input name="phone" type="tel" maxLength={27} required placeholder="0712 345 678" defaultValue={phone}/></label>}<button className="button button-gold align-start" type="submit" disabled={busy || !canPay}><LockKeyhole size={16}/>{busy ? "Connecting…" : method === "mpesa" ? "Send M-Pesa prompt" : method === "lipwa" ? "Set up Lipwa payment" : "Continue to payment provider"}</button></form>}
      </>}
      {verification && <p className="notice notice-success standalone-error" role="status">{verification}</p>}
      {error && <p className="form-error standalone-error" role="alert">{error}</p>}
      <div className="checkout-actions"><Link className="text-link" href="/dashboard?tab=orders">View your orders <ArrowRight size={16}/></Link>{data && !status && !pending && <button type="button" className="button button-outline button-sm" onClick={cancel} disabled={busy}>Cancel order</button>}</div>
    </section>
    <aside className="panel order-summary"><h2>Order summary</h2><strong>{target?.name || data?.order.description}</strong>{data && <small>Reference: {data.order.reference}</small>}<div className="order-total"><span>Total</span><strong>{money(target?.price ?? data?.order.amount ?? 0)}</strong></div>{option && option.currency !== "KES" && <small>Provider charge: {option.currency} {option.amount}</small>}<span className="detail-safety"><ShieldCheck size={18}/> Provider-verified checkout. Never share your PIN or one-time code.</span></aside>
  </div>;
}
