"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Send } from "lucide-react";
import { SERVICES } from "@/lib/catalog";
import { api, errorText, field } from "@/lib/client";
import { useMarket } from "./navigation";

export const contactLabels = { contact: "General enquiry", support: "Customer support", business: "Business enquiry", partnership: "Partnership enquiry", complaint: "Complaint", service: "Request a service quote", enquiry: "Enquire about a listing" } as const;
type Kind = keyof typeof contactLabels;
export function InquiryForm({ initial = "contact", service, listingSlug, title }: { initial?: Kind; service?: string; listingSlug?: string; title?: string }) {
  const { user } = useMarket();
  const [kind, setKind] = useState<Kind>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const chosenService = field(data, "service");
      const result = await api<{ reference: string }>("/api/enquiries", "POST", { kind, ...(!user ? { name: field(data, "name"), email: field(data, "email"), phone: field(data, "phone") } : {}), subject: title ?? (kind === "service" ? SERVICES.find((s) => s.slug === chosenService)?.name || "Professional service" : field(data, "subject")), message: field(data, "message"), website: field(data, "website"), listingSlug, service: chosenService || undefined });
      setReference(result.reference);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  if (reference) return <div className="form-success" role="status"><CheckCircle2 size={32}/><h3>Message received</h3><p>{kind === "enquiry" ? "Your enquiry is in the seller’s inbox." : "Your request is in our support inbox. We’ll reply to the email address you provided."}</p><small>Reference: {reference}</small><button className="button button-outline" type="button" onClick={() => setReference("")}>Send another message <ArrowRight size={16}/></button></div>;
  return <form className="form-stack" onSubmit={submit}>
    {!listingSlug && <label>How can we help?<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{Object.entries(contactLabels).filter(([key]) => key !== "enquiry").map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>}
    {user ? <div className="signed-note">Sending as <strong>{user.name}</strong> · {user.email}</div> : <>
      <div className="form-cols"><label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={100} placeholder="Your name" required/></label><label>Email address<input name="email" autoComplete="email" type="email" maxLength={180} placeholder="you@example.com" required/></label></div>
      <label>Phone <small>(optional)</small><input name="phone" autoComplete="tel" type="tel" maxLength={25} placeholder="+254 7XX XXX XXX"/></label>
    </>}
    {kind === "service" ? <label>Professional service<select name="service" defaultValue={service ?? ""} required><option value="" disabled>Select a service</option>{SERVICES.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label> : !title && <label>Subject<input name="subject" minLength={3} maxLength={140} placeholder="What is your message about?" required/></label>}
    <label>{kind === "service" ? "Tell us about your project" : "Message"}<textarea name="message" minLength={10} maxLength={4000} rows={5} required placeholder={kind === "service" ? "Tell us what you need, your timeframe and any budget you have in mind." : "Let us know how we can help."}/></label>
    <label className="trap" aria-hidden="true">Leave blank<input name="website" tabIndex={-1} autoComplete="off" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button button-gold align-start" disabled={busy}><Send size={16}/>{busy ? "Sending…" : kind === "service" ? "Request quotation" : kind === "enquiry" ? "Send enquiry" : "Send message"}</button>
    <p className="form-note">Please don’t include account passwords, payment PINs, or other sensitive information.</p>
  </form>;
}
