import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";
import { AccountForm, type AccountMode } from "@/components/account-form";
import { Eyebrow } from "@/components/blocks";
import { currentUser } from "@/lib/auth";
import { safeNext } from "@/lib/client";

const modes = {
  register: ["Create an account", "Join Kenya’s marketplace to buy, sell and grow."],
  login: ["Welcome back", "Log in to manage your listings, orders and account."],
  forgot: ["Reset your password", "Enter the email address linked to your account."],
  reset: ["Choose a new password", "Use a unique password with at least 10 characters."],
  verify: ["Verify your email", "One last step before you can start selling or make a purchase."],
} as const;
export async function generateMetadata({ params }: { params: Promise<{ mode: string }> }): Promise<Metadata> { return { title: modes[(await params).mode as AccountMode]?.[0] ?? "Account", robots: { index: false, follow: false } }; }
export default async function AccountPage({ params, searchParams }: { params: Promise<{ mode: string }>; searchParams: Promise<{ next?: string; intent?: string }> }) {
  const mode = (await params).mode as AccountMode;
  if (!Object.prototype.hasOwnProperty.call(modes, mode)) notFound();
  const [query, user] = await Promise.all([searchParams, currentUser()]);
  const next = typeof query.next === "string" ? safeNext(query.next) : undefined;
  const intent = query.intent === "sell" ? "sell" : undefined;
  if (user && (mode === "login" || mode === "register")) redirect(next || (intent ? "/dashboard?tab=listings&new=1" : user.role === "admin" ? "/admin" : "/dashboard"));
  return <main id="main-content" className="site-container interior-page account-page"><div className="account-layout">
    <aside className="account-art"><div><Eyebrow>JOHNSON DIGITAL EMPIRE</Eyebrow><h2>Good business<br/>starts <em>here.</em></h2><p>Find new customers, grow your brand and discover opportunities on a marketplace built for you.</p><span><ShieldCheck size={17}/> Secure account access</span></div></aside>
    <section className="panel account-panel"><Link className="back-link" href={mode === "login" || mode === "register" ? "/" : "/account/login"}><ArrowLeft size={15}/> {mode === "login" || mode === "register" ? "Back to home" : "Back to log in"}</Link><span className="category-icon"><Sparkles size={21}/></span><h1>{modes[mode][0]}</h1><p className="sub-copy">{modes[mode][1]}</p><AccountForm key={mode} mode={mode} intent={intent} next={next}/></section>
  </div></main>;
}
