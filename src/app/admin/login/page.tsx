import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { AccountForm } from "@/components/account-form";
import { Eyebrow } from "@/components/blocks";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Private administrator sign-in", robots: { index: false, follow: false, noarchive: true } };
export const dynamic = "force-dynamic";
export default async function AdminLoginPage() {
  if ((await currentUser())?.role === "admin") redirect("/admin");
  return <main id="main-content" className="site-container interior-page account-page admin-signin">
    <div className="account-layout">
      <aside className="account-art"><div><Eyebrow>JOHNSON DIGITAL EMPIRE</Eyebrow><h2>Marketplace<br/><em>operations.</em></h2><p>Publish category updates, manage sellers, and keep the marketplace running.</p><span><ShieldCheck size={17}/> Administrator access only</span></div></aside>
      <section className="panel account-panel"><Link className="back-link" href="/"><ArrowLeft size={15}/> Back to marketplace</Link><span className="category-icon"><LockKeyhole size={21}/></span><h1>Admin sign in</h1><p className="sub-copy">Sign in with your administrator account. Two-step verification protects this workspace.</p><AccountForm mode="login" next="/admin" adminOnly/></section>
    </div>
  </main>;
}
