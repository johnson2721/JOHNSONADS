import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Building2, Handshake, Headphones, Mail, MapPin, MessagesSquare } from "lucide-react";
import { Eyebrow } from "@/components/blocks";
import { InquiryForm } from "@/components/inquiry-form";
import { SERVICES, SUPPORT_EMAIL } from "@/lib/catalog";

export const metadata: Metadata = { title: "Contact & support" };
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ type?: string; service?: string }> }) {
  const { type, service } = await searchParams;
  const initial = type === "support" || type === "business" || type === "partnership" || type === "complaint" || type === "service" ? type : "contact";
  const requested = SERVICES.find((s) => s.slug === service);
  return <main className="site-container interior-page" id="main-content"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><strong>Contact & support</strong></nav>
    <section className="inner-banner"><div><Eyebrow>WE’RE HERE TO HELP</Eyebrow><h1>Let’s talk business.</h1><p>Get help with the marketplace, ask for a project quote, or explore a partnership.</p></div><MessagesSquare className="banner-icon" size={105} strokeWidth={.85}/></section>
    <div className="contact-layout"><aside className="contact-side"><div className="panel"><h2>Get in touch</h2><a className="info-line" href={`mailto:${SUPPORT_EMAIL}`}><span className="category-icon"><Mail size={19}/></span><span><strong>Email</strong><small>{SUPPORT_EMAIL}</small></span></a><div className="info-line"><span className="category-icon"><MapPin size={19}/></span><span><strong>Based in Kenya</strong><small>Nairobi, Kenya · East Africa Time</small></span></div></div>
      <div className="panel contact-paths"><h2>Choose a topic</h2>{[[Headphones, "Customer support", "support"], [Building2, "Business enquiry", "business"], [Handshake, "Partnership enquiry", "partnership"]].map(([Icon, label, value]) => { const Symbol = Icon as typeof Headphones; return <Link className={initial === value ? "selected" : ""} href={`/contact?type=${value}`} key={value as string}><Symbol size={18}/><span>{label as string}</span><ArrowUpRight size={15}/></Link>; })}</div></aside>
      <section className="panel form-panel" aria-label="Contact form"><Eyebrow>{initial === "service" ? "PROFESSIONAL SERVICES" : "CONTACT FORM"}</Eyebrow><h2>{requested?.name || (initial === "service" ? "Request a quotation" : "Send us a message")}</h2><p className="sub-copy">{initial === "service" ? "Share your requirements so we can prepare a quote for your project." : "Your message goes directly to our team. Please include any order reference that will help us respond."}</p><InquiryForm key={`${initial}:${service ?? ""}`} initial={initial} service={requested?.slug}/></section></div>
  </main>;
}
