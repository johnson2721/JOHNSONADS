import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard, Megaphone, ShieldCheck } from "lucide-react";
import { Eyebrow, Plans } from "@/components/blocks";
import { getPlans } from "@/lib/public-data";
import { hostedLipwaLink } from "@/lib/lipwa";

export const metadata: Metadata = { title: "Advertising packages" };
export const dynamic = "force-dynamic";
export default async function PricingPage() {
  const plans = await getPlans();
  return <main className="site-container interior-page" id="main-content"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><strong>Pricing</strong></nav>
    <section className="inner-banner"><div><Eyebrow>ADVERTISE WITH US</Eyebrow><h1>Give your business more visibility.</h1><p>Run a single campaign or choose a monthly promotion package. Clear pricing in Kenyan shillings.</p></div><Megaphone className="banner-icon" size={110} strokeWidth={.85}/></section>
    <section className="sub-section"><div className="section-header"><div><h2>Choose a promotion package</h2><p>Packages activate only after payment is confirmed. Renew manually when you’re ready.</p></div></div><Plans plans={plans}/>{hostedLipwaLink() && <div className="notice pricing-payment-note"><CreditCard size={19}/><div><strong>Pay with Lipwa in Kenyan shillings</strong><p>For a marketplace purchase, choose a package and create an order first so your Lipwa payment can be matched to it.</p><a className="text-link" href={hostedLipwaLink()?.toString()} target="_blank" rel="noopener noreferrer">Open the Lipwa payment page <ArrowRight size={15}/></a></div></div>}</section>
    <section className="sub-section"><div className="section-header"><div><h2>Common questions</h2></div></div><div className="panel faq-panel"><details><summary>How do I feature a listing?</summary><p>Buy a package, then use Promote on an approved listing in your dashboard. Your package determines how many featured listings can run at once.</p></details><details><summary>When does my package start?</summary><p>It starts when the payment provider confirms your transaction. You’ll see the expiry date and receipt in your dashboard.</p></details><details><summary>Will I be charged automatically every month?</summary><p>No. These packages renew only when you purchase again. An early renewal adds the new period to your existing balance of days.</p></details><details><summary>How do custom Enterprise campaigns work?</summary><p>After payment, contact the team with your order reference and campaign goals. We’ll agree on the next steps with you.</p></details></div></section>
    <div className="help-banner bottom-clear"><span className="category-icon"><ShieldCheck size={24}/></span><div><h2>Need a tailored plan?</h2><p>Talk to us about your audience, goals and advertising budget.</p></div><Link href="/contact?type=business" className="button button-ink">Ask the team <ArrowRight size={17}/></Link></div>
  </main>;
}
