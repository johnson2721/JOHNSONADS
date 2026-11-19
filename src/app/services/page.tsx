import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CheckCircle2 } from "lucide-react";
import { Eyebrow, ServiceGrid } from "@/components/blocks";

export const metadata: Metadata = { title: "Professional services" };
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const focus = (await searchParams).focus === "website";
  return <main className="site-container interior-page" id="main-content"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><strong>Professional services</strong></nav>
    <section className="inner-banner"><div><Eyebrow>WORK WITH AN EXPERT</Eyebrow><h1>{focus ? "Websites that work for you." : "Professional services"}</h1><p>Practical digital services to help you launch, grow and stand out in a competitive market.</p><Link className="button button-gold" href={focus ? "/contact?type=service&service=website-development" : "/contact?type=service"}>Request a quotation <ArrowRight size={17}/></Link></div><BriefcaseBusiness className="banner-icon" size={113} strokeWidth={.85}/></section>
    <section className="sub-section"><div className="section-header"><div><Eyebrow>FIND THE RIGHT SUPPORT</Eyebrow><h2>What we can help with</h2><p>Choose a service and tell us what you want to achieve.</p></div></div><ServiceGrid/></section>
    <section className="sub-section"><div className="section-header"><div><h2>How it works</h2></div></div><div className="process-grid">{[["01", "Tell us what you need", "Share your project, deadlines and any requirements."], ["02", "Review your quote", "We’ll follow up with scope, timing and pricing. Signed-in customers can see quotes under Orders."], ["03", "Approve and pay securely", "Pay only once you’re happy with the quote. Work begins after confirmed payment."]].map(([step, title, text]) => <article className="panel" key={step}><span className="step-tag">{step}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <div className="help-banner bottom-clear"><span className="category-icon"><CheckCircle2 size={25}/></span><div><h2>Not sure what you need?</h2><p>Tell us a little about your business and we’ll help you choose the right next step.</p></div><Link href="/contact?type=business" className="button button-ink">Talk to us <ArrowRight size={17}/></Link></div>
  </main>;
}
