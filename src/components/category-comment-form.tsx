"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Info, Send } from "lucide-react";
import { api, errorText, field } from "@/lib/client";
import { useMarket } from "./navigation";

export function CategoryCommentForm({ category, enabled }: { category: string; enabled: boolean }) {
  const { user } = useMarket();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = e.currentTarget;
    try { await api(`/api/categories/${encodeURIComponent(category)}/comments`, "POST", { body: field(new FormData(form), "body") }); form.reset(); setNotice("Comment submitted. It will appear here after review."); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  if (!enabled) return <p className="category-discussion-note">New comments are paused for this category.</p>;
  if (!user) return <div className="category-discussion-note"><Link className="text-link" href={`/account/login?next=${encodeURIComponent(`/marketplace?category=${category}#comments`)}`}>Log in to join the discussion</Link><span>Comments are reviewed before they appear.</span></div>;
  if (!user.verified) return <div className="notice"><Info size={17}/><div>Verify your email to comment. <Link className="text-link" href="/dashboard">Open your dashboard</Link></div></div>;
  return <form className="form-stack category-comment-form" method="post" onSubmit={submit}><label>Add a comment<textarea name="body" placeholder="Share something helpful about this category…" rows={3} minLength={3} maxLength={1000} required /></label><p className="form-note">Comments are reviewed before they’re published. Please don’t share your contact or payment details.</p>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice notice-success" role="status">{notice}</p>}<button className="button button-gold button-sm align-start" type="submit" disabled={busy}><Send size={15}/>{busy ? "Posting…" : "Submit comment"}</button></form>;
}
