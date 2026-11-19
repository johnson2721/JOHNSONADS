"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { BUSINESS_CATEGORIES, COUNTRIES } from "@/lib/catalog";
import { api, errorText, field, safeNext, type Account } from "@/lib/client";
import { AdminActivationForm } from "./admin-activation-form";

export type AccountMode = "register" | "login" | "forgot" | "reset" | "verify";
export function AccountForm({ mode, intent, next, adminOnly = false }: { mode: AccountMode; intent?: string; next?: string; adminOnly?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [mfa, setMfa] = useState(false), [show, setShow] = useState(false);
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [code, setCode] = useState("");
  const register = mode === "register", login = mode === "login", forgot = mode === "forgot", reset = mode === "reset", verify = mode === "verify";
  useEffect(() => {
    if (verify || reset) {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (value) { setCode(value); window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); }
    }
  }, [verify, reset]);
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const email = field(form, "email"), password = field(form, "password");
      if (register || login) {
        const values = register ? { name: field(form, "name"), email, phone: field(form, "phone"), country: field(form, "country"), businessName: field(form, "businessName"), category: field(form, "category"), password, seller: form.get("seller") === "yes" } : { email, password, code: field(form, "code") || undefined };
        const result = await api<{ user?: Account; mfaRequired?: boolean; setupRequired?: boolean; setupKey?: string }>(`/api/auth/${adminOnly ? "admin-login" : mode}`, "POST", values);
        if (result.setupRequired && result.setupKey) { setShow(false); setSetupKey(result.setupKey); return; }
        if (result.mfaRequired) { setMfa(true); return; }
        const destination = next ? safeNext(next) : result.user?.role === "admin" ? "/admin" : register && values && "seller" in values && values.seller ? "/dashboard?tab=listings&new=1" : "/dashboard";
        router.replace(destination); router.refresh();
      } else if (forgot) {
        await api("/api/auth/forgot", "POST", { email });
        setMessage("If this account can be reset by email, we’ll send a single-use link shortly. Check your spam folder as well.");
      } else {
        if (!code) throw new Error("This link is missing or has expired. Request a new one and try again.");
        await api(`/api/auth/${mode}`, "POST", { token: code, ...(reset ? { password } : {}) });
        setMessage(verify ? "Your email is verified. You can now publish listings and pay for orders." : "Your password has been updated. Log in with your new password.");
        router.refresh();
      }
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  if (setupKey) return <AdminActivationForm setupKey={setupKey} onCancel={() => { setSetupKey(""); setMfa(false); }} onDone={() => { setSetupKey(""); router.replace("/admin"); router.refresh(); }}/>;
  if (message) return <div className="form-success" role="status"><CheckCircle2 size={32}/><h3>{verify ? "Email verified" : reset ? "Password updated" : "Check your inbox"}</h3><p>{message}</p><Link href={verify ? "/dashboard" : "/account/login"} className="button button-gold">{verify ? "Open dashboard" : "Back to log in"}<ArrowRight size={16}/></Link></div>;
  return <form className="form-stack auth-form" method="post" onSubmit={submit}>
    {register && <label>Full name<input name="name" autoComplete="name" placeholder="Your full name" minLength={2} maxLength={100} required/></label>}
    {(register || login || forgot) && <label>Email address<input name="email" type="email" autoComplete={login ? "username" : "email"} placeholder="you@example.com" maxLength={180} readOnly={mfa} required/></label>}
    {register && <><div className="form-cols"><label>Phone number<input name="phone" type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" minLength={7} maxLength={25} required/></label><label>Country<select name="country" defaultValue="Kenya" autoComplete="country-name">{COUNTRIES.map((value) => <option key={value}>{value}</option>)}</select></label></div><div className="form-cols"><label>Business name <small>(optional)</small><input name="businessName" autoComplete="organization" placeholder="Your business" maxLength={110}/></label><label>Business category<select name="category" defaultValue="Other">{BUSINESS_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label></div></>}
    {(register || login || reset) && <label><div className="password-header"><span>{reset ? "New password" : "Password"}</span>{login && !adminOnly && <Link href="/account/forgot">Forgot password?</Link>}</div><div className="password-field"><input name="password" type={show ? "text" : "password"} autoComplete={login ? "current-password" : "new-password"} placeholder={register || reset ? "At least 10 characters" : "Enter your password"} minLength={login ? 1 : 10} maxLength={128} readOnly={mfa} required/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>}
    {mfa && <><div className="notice"><ShieldCheck size={17}/><span>Enter the current verification code from your administrator authenticator app.</span></div><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" autoFocus required/></label></>}
    {register && <><label className="check-row"><input type="checkbox" name="seller" value="yes" defaultChecked={intent === "sell"}/> I plan to sell or promote a business</label><p className="form-note">By creating an account you agree to the <Link href="/privacy">privacy and marketplace terms</Link>.</p></>}
    {verify && <div className="notice"><KeyRound size={18} /><span>Confirm this link to verify your address. If it’s expired, request another link from your dashboard.</span></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button button-gold auth-submit" disabled={busy}>{busy ? "Please wait…" : mfa ? "Verify and log in" : { register: "Create account", login: "Log in", forgot: "Send reset link", reset: "Update password", verify: "Verify my email" }[mode]}<ArrowRight size={17}/></button>
    {!adminOnly && (register || login || forgot) && <p className="auth-alternative">{register ? <>Already have an account? <Link href={`/account/login${query}`}>Log in</Link></> : login ? <>New to Johnson Digital Empire? <Link href={`/account/register${query}`}>Create an account</Link></> : <Link href="/account/login">Back to log in</Link>}</p>}
  </form>;
}
