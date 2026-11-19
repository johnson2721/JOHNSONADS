import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Empty, Eyebrow } from "@/components/blocks";
import { CheckoutPanel } from "@/components/checkout-panel";
import { currentUser } from "@/lib/auth";
import { getListing, getPlans } from "@/lib/public-data";
import { checkoutData } from "@/lib/payments";
import { AppError } from "@/lib/security";

export const metadata: Metadata = { title: "Secure checkout", robots: { index: false } };
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string; listing?: string; order?: string; returned?: string; cancelled?: string }> }) {
  const input = await searchParams;
  const value = (key: "plan" | "listing" | "order") => typeof input[key] === "string" ? input[key].slice(0, 140) : "";
  const plan = value("plan"), slug = value("listing"), order = value("order");
  const user = await currentUser();
  const dest = order ? `/checkout?order=${encodeURIComponent(order)}${input.returned === "1" ? "&returned=1" : ""}` : plan ? `/checkout?plan=${encodeURIComponent(plan)}` : slug ? `/checkout?listing=${encodeURIComponent(slug)}` : "/pricing";
  if (!user) redirect(`/account/login?next=${encodeURIComponent(dest)}`);
  const data = order ? await checkoutData(user, order).catch((error) => { if (error instanceof AppError && error.status === 404) return undefined; throw error; }) : undefined;
  const selected = !order && plan ? (await getPlans()).find((row) => row.slug === plan) : undefined;
  const item = !order && slug ? (await getListing(slug))?.listing : undefined;
  const target = selected ? { kind: "plan" as const, slug: selected.slug, name: `${selected.name} advertising package`, price: selected.price } : item && !item.example && item.kind === "products" && item.price && item.ownerId && item.ownerId !== user.id ? { kind: "product" as const, slug: item.slug, name: item.title, price: item.price } : undefined;
  return <main id="main-content" className="site-container interior-page"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/dashboard?tab=orders">Orders</Link><span>/</span><strong>Checkout</strong></nav><section className="inner-banner"><div><Eyebrow>JOHNSON DIGITAL EMPIRE</Eyebrow><h1>Secure checkout</h1><p>Review your order and choose an available payment method.</p></div><LockKeyhole className="banner-icon" size={95} strokeWidth={.85}/></section><section className="sub-section">{data || target ? <CheckoutPanel key={data?.order.id ?? target?.slug} target={target} data={data} phone={user.phone} verified={user.verified} returned={input.returned === "1"} cancelled={input.cancelled === "1"}/> : <Empty title="This order isn’t available" text="Choose an active package or go back to a listing." href="/pricing" action="View advertising packages"/>}</section></main>;
}
