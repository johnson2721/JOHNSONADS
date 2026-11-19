import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BadgeCheck, Building2, ExternalLink, Info, MapPin, ShieldCheck, ShoppingBag, Tag } from "lucide-react";
import { CategoryIcons, Eyebrow, ListingGrid, TextLink } from "@/components/blocks";
import { Gallery } from "@/components/listing-detail";
import { InquiryForm } from "@/components/inquiry-form";
import { SaveButton } from "@/components/navigation";
import { currentUser } from "@/lib/auth";
import { categoryName, money } from "@/lib/catalog";
import { categoryUrl } from "@/lib/client";
import { findListings, getListing } from "@/lib/public-data";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const row = await getListing((await params).slug);
  return { title: row?.listing.title || "Listing", description: row?.listing.description.slice(0, 150) };
}
export default async function ListingDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [row, user] = await Promise.all([getListing(slug), currentUser()]);
  if (!row) notFound();
  const { listing, seller } = row;
  const category = categoryName(listing.kind);
  const Icon = CategoryIcons[listing.kind] ?? Tag;
  const related = (await findListings({ kind: listing.kind })).items.filter((item) => item.slug !== slug).slice(0, 4);
  const mine = listing.ownerId === user?.id;
  const canEnquire = !listing.example && !mine && !!(listing.ownerId || listing.managedCategory);
  const online = listing.kind === "products" && !!listing.price && !listing.example && !mine && !!listing.ownerId;
  return <main id="main-content" className="site-container interior-page">
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/marketplace">Marketplace</Link><span>/</span><Link href={categoryUrl(listing.kind)}>{category}</Link><span>/</span><strong>{listing.title}</strong></nav>
    <div className="detail-grid"><Gallery images={listing.images} title={listing.title} slug={slug} />
      <section className="detail-side panel"><span className="detail-kind"><Icon size={16} />{category} <i /> {listing.category}</span><h1>{listing.title}</h1><p className="detail-location"><MapPin size={17} /> {listing.location}</p>
        <div className="detail-price">{listing.price ? <><strong>{money(listing.price)}</strong><span>{listing.priceUnit}</span></> : <strong>Enquire for details</strong>}</div>
        {seller && <div className="seller-mini"><span className="category-icon"><Building2 size={20}/></span><div><strong>{seller.businessName || seller.name}</strong><small>{seller.verified && <BadgeCheck size={14}/>} {seller.verified ? "Email-verified seller" : "Marketplace seller"}</small></div></div>}
        {listing.example && <div className="notice"><Info size={18}/><span><strong>Example listing.</strong> This item is for browsing and is not available to buy or enquire about.</span></div>}
        <div className="button-row">{online && <Link className="button button-gold" href={`/checkout?listing=${slug}`}><ShoppingBag size={17}/> Buy now <ArrowRight size={16}/></Link>}{canEnquire && <Link className={`button ${online ? "button-outline" : "button-gold"}`} href="#enquire">Enquire now <ArrowRight size={16}/></Link>}{listing.example && <Link className="button button-gold" href={categoryUrl(listing.kind)}>Explore {category.toLowerCase()} <ArrowRight size={16}/></Link>}{listing.sellerWebsite && <a className="button button-outline" target="_blank" rel="noopener noreferrer" href={listing.sellerWebsite}>Seller website <ExternalLink size={15}/></a>}<SaveButton slug={slug} title={listing.title} labelled /></div>
        {mine && <TextLink href="/dashboard?tab=listings">Manage this listing</TextLink>}
        <p className="detail-safety"><ShieldCheck size={16}/> Verify the listing and never share your payment PIN.</p>
      </section>
    </div>
    <div className="detail-below"><section className="panel"><Eyebrow>THE DETAILS</Eyebrow><h2>{listing.managedCategory ? "About this seller" : "About this listing"}</h2><p className="preserve">{listing.description}</p></section>
    {canEnquire && <section className="panel" id="enquire"><Eyebrow>CONTACT THE SELLER</Eyebrow><h2>Make an enquiry</h2><InquiryForm initial="enquiry" listingSlug={slug} title={listing.title}/></section>}</div>
    {related.length > 0 && <section className="sub-section"><div className="section-header"><div><h2>You may also like</h2><p>Explore other listings in {category.toLowerCase()}.</p></div><TextLink href={categoryUrl(listing.kind)}>Browse {category.toLowerCase()}</TextLink></div><ListingGrid items={related}/></section>}
  </main>;
}
