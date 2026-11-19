import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Eyebrow } from "@/components/blocks";
import { SUPPORT_EMAIL } from "@/lib/catalog";

export const metadata: Metadata = { title: "Privacy & marketplace terms" };
export default function PrivacyPage() {
  return <main className="site-container interior-page" id="main-content"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><strong>Privacy & marketplace terms</strong></nav><section className="inner-banner"><div><Eyebrow>TRADE WITH CONFIDENCE</Eyebrow><h1>Privacy & marketplace terms</h1><p>How account, listing, and payment information is used.</p></div><ShieldCheck className="banner-icon" size={107} strokeWidth={.85}/></section>
    <article className="sub-section panel policy-panel"><h2>Your information</h2><p>We use the information you provide to manage your account, publish listings, handle enquiries and process orders. An enquiry may be shared with the relevant seller and the marketplace support team. Guest saves are stored in your browser; signed-in saves are stored with your account.</p><h2>Payments and receipts</h2><p>Our payment partners collect payment credentials directly. Johnson Digital Empire records the amount, status and transaction references required to fulfil and reconcile orders. Never send a PIN, one-time code, or card details in a message or email.</p><h2>Responsible selling</h2><p>Only list products, property, vehicles, services and opportunities you are authorised to advertise. Describe them accurately, upload images you have permission to use and keep prices current. Listings may be moderated, and abusive or fraudulent accounts may be suspended.</p><h2>Support and requests</h2><p>To correct account data, report a listing, request a refund, or ask how your information is used, contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use the <Link href="/contact?type=support">support form</Link>. Refunds must be reviewed and confirmed through the payment provider before they appear as refunded.</p></article>
  </main>;
}
