"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, Copy, Info, RefreshCw } from "lucide-react";
import { money } from "@/lib/catalog";
import { field } from "@/lib/client";

export function LipwaPending({ url, amount, order, reference, ready, busy, onCheck }: { url: string | null; amount: number; order: string; reference: string | null; ready: boolean; busy: boolean; onCheck: (value: string) => void }) {
  const [copied, setCopied] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onCheck(field(new FormData(e.currentTarget), "reference")); };
  return <div className="lipwa-flow">
    <div className="notice"><Clock3 size={21}/><div><strong>Waiting for Lipwa confirmation</strong><p>Pay exactly <strong>{money(amount)}</strong> on Lipwa. If you already paid, enter the transaction reference below instead of paying again.</p></div></div>
    {!ready && <div className="notice"><Info size={18}/><div><strong>Automatic verification is not connected</strong><p>Contact support before sending a live payment. Any reference you submit will be saved, but this order won’t be marked paid until verification is connected.</p></div></div>}
    <div className="lipwa-reference"><div><small>Order reference</small><strong>{order}</strong></div><button className="button button-outline button-sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(order); setCopied(true); } catch {} }}><Copy size={14}/>{copied ? "Copied" : "Copy"}</button></div>
    {url && <a className="button button-gold align-start" href={url} target="_blank" rel="noopener noreferrer">Open Lipwa checkout <ArrowUpRight size={17}/></a>}
    <form className="form-stack lipwa-verify-form" method="post" onSubmit={submit}><label>M-Pesa code or Lipwa payment reference<input name="reference" placeholder="e.g. your 10-character M-Pesa code" maxLength={120} minLength={4} autoComplete="off" defaultValue={reference ?? ""} required /></label><p className="form-note">Use the transaction reference from Lipwa or your receipt. Never enter a PIN or one-time code.</p><div className="button-row"><button className="button button-outline" type="submit" disabled={busy}><RefreshCw size={16}/>{busy ? "Checking…" : ready ? "Verify payment" : "Save payment reference"}</button><Link className="text-link" href="/contact?type=support">Get payment help <ArrowUpRight size={15}/></Link></div></form>
  </div>;
}
