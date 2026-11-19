"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { api, errorText, field, type Account } from "@/lib/client";

export function AdminActivationForm({ setupKey, onDone, onCancel }: { setupKey: string; onDone: (user: Account) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    try {
      const password = field(form, "password");
      if (password !== field(form, "confirmation")) throw new Error("The new passwords do not match.");
      const { user } = await api<{ user: Account }>("/api/auth/admin-activate", "POST", { password, code: field(form, "code") });
      onDone(user);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  return <form className="form-stack activation-form" method="post" onSubmit={submit}>
    <div className="notice"><ShieldCheck size={20}/><div><strong>Finish setting up the private portal</strong><p>Replace the temporary password and enrol an authenticator before accessing the dashboard.</p></div></div>
    <div className="auth-key"><span><KeyRound size={16}/> Authenticator setup key</span><div><code>{setupKey}</code><button type="button" className="button button-outline button-sm" aria-label="Copy authenticator setup key" onClick={async () => { try { await navigator.clipboard.writeText(setupKey); setCopied(true); } catch { setError("Select and copy the setup key manually."); } }}><Copy size={14}/>{copied ? "Copied" : "Copy"}</button></div><small>Add a time-based account in your authenticator app using this key, then enter its six-digit code. Do not share this key.</small></div>
    <label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required/></label>
    <label>New administrator password<input name="password" type="password" autoComplete="new-password" minLength={16} maxLength={128} placeholder="At least 16 characters" required/></label>
    <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={16} maxLength={128} required/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button button-gold auth-submit" disabled={busy}>{busy ? "Securing your portal…" : "Activate admin access"}<ArrowRight size={17}/></button>
    <button type="button" className="button button-outline align-start" onClick={onCancel}>Back to sign in</button>
  </form>;
}
