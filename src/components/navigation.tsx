"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, CircleHelp, Globe2, Heart, MapPin, Menu, Plus, UserRound, X } from "lucide-react";
import { api, errorText, type Account } from "@/lib/client";
import type { CardListing } from "@/lib/catalog";

const storageKey = "jde-saved-listings-v1";
type Settings = { user: Account | null; saved: string[]; toggle: (slug: string) => Promise<void>; toast: (message: string) => void; ready: boolean };
const Context = createContext<Settings>({ user: null, saved: [], toggle: async () => {}, toast: () => {}, ready: false });
export const useMarket = () => useContext(Context);
export function MarketProvider({ user, children }: { user: Account | null; children: ReactNode }) {
  const [saved, setSaved] = useState<string[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const who = user?.id || "guest";
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const values = who === "guest" ? JSON.parse(localStorage.getItem(storageKey) ?? "[]") : (await api<{ items: CardListing[] }>("/api/saved")).items.map((item) => item.slug);
        if (live) setSaved(Array.isArray(values) ? values.filter((v) => typeof v === "string").slice(0, 100) : []);
      } catch { if (live) setSaved([]); }
      if (live) setLoadedId(who);
    };
    void read();
    return () => { live = false; };
  }, [who]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timeout);
  }, [notice]);
  const toggle = useCallback(async (slug: string) => {
    if (loadedId !== who) return;
    const adding = !saved.includes(slug);
    try {
      if (user) await api(`/api/saved/${encodeURIComponent(slug)}`, "POST", { save: adding });
      setSaved((previous) => {
        const next = adding ? [...new Set([...previous, slug])].slice(-100) : previous.filter((v) => v !== slug);
        if (!user) { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} }
        return next;
      });
      setNotice(adding ? "Listing saved" : "Listing removed from saved");
    } catch (error) { setNotice(errorText(error)); }
  }, [saved, loadedId, who, user]);
  return <Context.Provider value={{ user, saved: loadedId === who ? saved : [], toggle, toast: setNotice, ready: loadedId === who }}>{children}{notice && <div className="site-toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" type="button" onClick={() => setNotice("")}><X size={16} /></button></div>}</Context.Provider>;
}
export function Brand({ footer = false }: { footer?: boolean }) {
  return <Link href="/" className={`brand ${footer ? "brand-footer" : ""}`} aria-label="Johnson Digital Empire home"><Image src="/jde.svg" width={42} height={42} unoptimized alt="" /><span className="brand-name"><strong>JOHNSON</strong><small>DIGITAL EMPIRE</small></span></Link>;
}
export function Header({ announcement }: { announcement?: string }) {
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const { user, saved } = useMarket();
  const sell = user ? "/dashboard?tab=listings&new=1" : "/account/register?intent=sell";
  const account = user?.role === "admin" ? "/admin" : user ? "/dashboard" : "/account/login";
  const active = (key: string) => key === "/marketplace" ? pathname === "/" || pathname.startsWith("/marketplace") : pathname.startsWith(key);
  const links = [["Marketplace", "/marketplace"], ["Services", "/services"], ["Pricing", "/pricing"], ["About Us", "/#about"]];
  return <header className="site-header">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="top-strip"><div className="site-container strip-row">
      <div className="strip-location"><MapPin size={13} /> <span>{announcement || "Proudly built in Kenya"}</span></div>
      <div className="strip-extra"><Link href="/contact"><CircleHelp size={13} /> Help & Support</Link><span className="strip-divider" /><span><Globe2 size={13} /> Kenya · KES</span></div>
    </div></div>
    <div className="nav-border"><div className="site-container nav-row">
      <Brand />
      <nav className={`main-nav ${mobile ? "is-open" : ""}`} aria-label="Main navigation" id="main-navigation">
        {links.map(([label, href]) => <Link onClick={() => setMobile(false)} key={label} href={href} className={active(href) ? "active" : ""} aria-current={active(href) ? "page" : undefined}>{label}</Link>)}
        <Link href={account} className="mobile-only" onClick={() => setMobile(false)}><UserRound size={17} /> {user ? "My Dashboard" : "Log in"}</Link>
        <Link href={sell} className="mobile-only" onClick={() => setMobile(false)}><Plus size={17} /> Start Selling <ArrowUpRight size={15}/></Link>
      </nav>
      <div className="nav-actions">
        <Link href="/saved" className="nav-icon" aria-label={saved.length ? `Saved listings (${saved.length})` : "Saved listings"}><Heart size={20} />{saved.length > 0 && <i />}</Link><span className="nav-divider" />
        <Link href={account} className="login-link"><UserRound size={17}/><span>{user ? "Dashboard" : "Log in"}</span></Link>
        <Link className="button button-gold nav-sell" href={sell} aria-label="Start Selling"><Plus size={17} /> Start Selling</Link>
        <button className="nav-icon menu-toggle" aria-label={mobile ? "Close navigation" : "Open navigation"} aria-expanded={mobile} aria-controls="main-navigation" type="button" onClick={() => setMobile(!mobile)}>{mobile ? <X size={23} /> : <Menu size={23} />}</button>
      </div>
    </div></div>
  </header>;
}
export function SaveButton({ slug, title, labelled = false }: { slug: string; title: string; labelled?: boolean }) {
  const { saved, toggle, ready } = useMarket();
  const [busy, setBusy] = useState(false);
  const isSaved = saved.includes(slug);
  return <button disabled={busy || !ready} type="button" aria-pressed={isSaved} aria-label={`${isSaved ? "Remove " : "Save "}${title}${isSaved ? " from saved" : ""}`} data-saved={isSaved} className={labelled ? "button button-outline save-labelled" : "save-button"} onClick={async () => { setBusy(true); await toggle(slug); setBusy(false); }}><Heart size={19} fill={isSaved ? "currentColor" : "none"} />{labelled ? isSaved ? "Saved" : "Save listing" : null}</button>;
}
export function SignOut() {
  const router = useRouter(); const { toast } = useMarket(); const [busy, setBusy] = useState(false);
  return <button className="button button-outline button-sm" type="button" disabled={busy} onClick={async () => { setBusy(true); try { await api("/api/auth/logout", "POST"); router.push("/"); router.refresh(); } catch (error) { toast(errorText(error)); setBusy(false); } }}>{busy ? "Signing out…" : "Sign out"}</button>;
}
