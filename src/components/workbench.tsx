"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CircleCheck, Reply, type LucideIcon } from "lucide-react";
import { api, errorText, field } from "@/lib/client";
import { SignOut } from "./navigation";

export function Status({ value }: { value: string }) { return <span className="status-tag" data-status={value}><i />{value.replaceAll("_", " ")}</span>; }
export function WorkHeader({ title, eyebrow, text, children }: { title: string; eyebrow: string; text: string; children?: ReactNode }) { return <div className="work-header"><div><span className="eyebrow"><i />{eyebrow}</span><h1>{title}</h1><p>{text}</p></div><div className="button-row">{children}<SignOut/></div></div>; }
export function Metric({ label, value, icon: Icon, detail }: { label: string; value: ReactNode; icon: LucideIcon; detail?: string }) { return <article className="metric-card"><div><span>{label}</span><span className="category-icon"><Icon size={18}/></span></div><strong>{value}</strong>{detail && <small>{detail}</small>}</article>; }
export function Table({ labels, children }: { labels: string[]; children: ReactNode }) { return <div className="table-scroll"><table className="work-table"><thead><tr>{labels.map((value) => <th scope="col" key={value}>{value}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
export function InlineEmpty({ children }: { children: ReactNode }) { return <p className="inline-empty">{children}</p>; }
export function ReplyBox({ id, quote = false, onSuccess }: { id: string; quote?: boolean; onSuccess: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError(""); const data = new FormData(e.currentTarget);
    try { await api(`/api/enquiries/${id}/reply`, "POST", { response: field(data, "response"), ...(field(data, "quote") ? { quote: Number(field(data, "quote")) } : {}) }); setOpen(false); await onSuccess(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  return <div className="reply-box">{!open ? <button type="button" className="button button-outline button-sm" onClick={() => setOpen(true)}><Reply size={15}/>{quote ? "Reply or send quote" : "Reply"}</button> : <form className="form-stack" onSubmit={submit}><label>Reply<textarea name="response" placeholder="Write a reply…" minLength={3} maxLength={4000} rows={3} required/></label>{quote && <label>Quote in KSh <small>(optional)</small><input name="quote" type="number" min={1} max={500000000} step={1} /></label>}{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button className="button button-gold button-sm" disabled={busy} type="submit">{busy ? "Sending…" : "Send reply"} <ArrowRight size={15}/></button><button className="button button-outline button-sm" type="button" onClick={() => setOpen(false)}>Cancel</button></div></form>}</div>;
}
export function ConfirmNotice({ message }: { message: string }) { return <p className="work-success" role="status"><CircleCheck size={15}/> {message}</p>; }
