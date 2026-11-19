import Link from "next/link";
import { ArrowRight, ArrowUpRight, Briefcase, Building2, CarFront, Check, CircleDollarSign, Code2, Globe2, Headphones, ImageIcon, LayoutTemplate, Mail, MapPin, Megaphone, Monitor, Palette, ShieldCheck, ShoppingBag, Sparkles, Store, TrendingUp, UsersRound, type LucideIcon } from "lucide-react";
import { CATEGORIES, SERVICES, SUPPORT_EMAIL, TAGLINE, categoryName, money, type CardListing, type Plan } from "@/lib/catalog";
import { categoryUrl } from "@/lib/client";
import { Brand, SaveButton } from "./navigation";

export const CategoryIcons: Record<string, LucideIcon> = { products: ShoppingBag, businesses: Store, services: Briefcase, property: Building2, vehicles: CarFront, jobs: UsersRound, advertising: Megaphone, "web-design": Monitor };
const ServiceIcons = [Code2, TrendingUp, Megaphone, Palette, LayoutTemplate, Sparkles, Briefcase];
export function Eyebrow({ children }: { children: React.ReactNode }) { return <span className="eyebrow"><i />{children}</span>; }
export function TextLink({ href, children, diagonal = false }: { href: string; children: React.ReactNode; diagonal?: boolean }) { return <Link href={href} className="text-link">{children}{diagonal ? <ArrowUpRight size={16} /> : <ArrowRight size={16} />}</Link>; }
export function CategoryGrid() {
  return <div className="category-grid">{CATEGORIES.map((category) => {
    const Icon = CategoryIcons[category.key];
    return <Link key={category.key} href={categoryUrl(category.key)} className="category-tile"><span className="category-icon"><Icon size={23} strokeWidth={1.75} /></span><strong>{category.name}</strong><small>{category.detail}</small></Link>;
  })}</div>;
}
export function ListingCard({ item }: { item: CardListing }) {
  const Icon = CategoryIcons[item.kind] || ImageIcon;
  const href = `/marketplace/${item.slug}`;
  return <article className="listing-card">
    <div className="listing-media">
      <Link href={href} className="listing-image-link" tabIndex={-1} aria-hidden="true">{item.images[0] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={item.images[0]} alt="" loading="lazy" decoding="async"/> : <span className="listing-placeholder"><Icon size={46} strokeWidth={1.1} /></span>}</Link>
      {(item.featured || item.badge) && <span className={`listing-badge ${(item.featured || item.badge === "Featured") ? "listing-badge-gold" : ""}`}>{item.featured && <Sparkles size={13} />}{item.featured ? "Featured" : item.badge}</span>}
      <SaveButton slug={item.slug} title={item.title} />
    </div>
    <div className="listing-body">
      <span className="listing-type">{categoryName(item.kind)} <i /> {item.category}</span>
      <h3><Link href={href}>{item.title}</Link></h3>
      <p className="listing-location"><MapPin size={14} />{item.location}</p>
      <div className="listing-bottom"><div>{item.price ? <><strong>{money(item.price)}</strong>{item.priceUnit && <small> {item.priceUnit}</small>}</> : <strong className="listing-quote">Enquire for details</strong>}</div><Link href={href} aria-label={`View ${item.title}`} className="listing-arrow"><ArrowUpRight size={17} /></Link></div>
    </div>
  </article>;
}
export function ListingGrid({ items }: { items: CardListing[] }) { return <div className="listing-grid">{items.map((item) => <ListingCard key={item.slug} item={item}/>)}</div>; }
export function Plans({ plans }: { plans: Plan[] }) {
  if (!plans.length) return <Empty title="New packages are on the way" text="Get in touch for a tailored advertising quote." href="/contact?type=business" action="Talk to us" />;
  return <div className="plan-grid">{plans.map((plan) => <article key={plan.slug} className={`plan-card ${plan.slug === "business" ? "plan-highlight" : ""}`}>
    {plan.slug === "business" && <span className="plan-label"><Sparkles size={13} /> POPULAR</span>}
    <h3>{plan.name}</h3><p>{plan.description}</p>
    <div className="plan-price"><strong>{money(plan.price)}</strong><small>{plan.days === 30 ? "/ month" : ` / ${plan.days} days`}</small></div>
    <Link href={`/checkout?plan=${plan.slug}`} className={`button ${plan.slug === "business" ? "button-gold" : "button-outline"}`}>Choose {plan.name}<ArrowRight size={16} /></Link>
    <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}</ul>
  </article>)}</div>;
}
export function ServiceGrid() {
  return <div className="service-grid">{SERVICES.map((service, index) => { const Icon = ServiceIcons[index]; return <Link href={`/contact?type=service&service=${service.slug}`} key={service.slug} className="service-card"><span className="category-icon"><Icon size={23} strokeWidth={1.8}/></span><div><h3>{service.name}</h3><p>{service.text}</p></div><ArrowUpRight className="service-arrow" size={18} /></Link>; })}</div>;
}
export function TrustStrip() {
  return <div className="trust-strip">{[[Globe2, "Made for Kenya", "Local discovery, global ambition."], [ShieldCheck, "Provider-verified checkout", "Payments are confirmed before activation."], [Headphones, "Real business support", "Get help at every step."]].map(([Icon, title, description]) => { const Symbol = Icon as LucideIcon; return <div className="trust-item" key={title as string}><span className="category-icon"><Symbol size={22}/></span><div><strong>{title as string}</strong><small>{description as string}</small></div></div>; })}</div>;
}
export function Empty({ title, text, href, action, icon: Icon = ShoppingBag }: { title: string; text: string; href?: string; action?: string; icon?: LucideIcon }) {
  return <div className="empty-state"><span className="category-icon"><Icon size={24}/></span><h3>{title}</h3><p>{text}</p>{href && action && <Link className="button button-gold" href={href}>{action}<ArrowRight size={16}/></Link>}</div>;
}
export function Footer() {
  return <footer className="site-footer"><div className="site-container">
    <div className="footer-grid"><div><Brand footer /><p>{TAGLINE}</p><span className="footer-location"><MapPin size={15}/> Nairobi, Kenya</span></div>
      <div><h3>Marketplace</h3><Link href={categoryUrl("products")}>Shop products</Link><Link href={categoryUrl("businesses")}>Find a business</Link><Link href={categoryUrl("property")}>Browse property</Link><Link href={categoryUrl("jobs")}>Find jobs</Link></div>
      <div><h3>Grow with us</h3><Link href="/account/register?intent=sell">Start selling</Link><Link href="/services">Professional services</Link><Link href="/pricing">Advertising packages</Link><Link href="/contact?type=partnership">Partner with us</Link></div>
      <div><h3>Support</h3><Link href="/contact?type=support">Help & support</Link><Link href="/contact">Contact us</Link><Link href="/privacy">Privacy & marketplace terms</Link><a href={`mailto:${SUPPORT_EMAIL}`}><Mail size={14}/>{SUPPORT_EMAIL}</a></div>
    </div><div className="footer-bottom"><span>© {new Date().getFullYear()} Johnson Digital Empire. All rights reserved.</span><span><CircleDollarSign size={15} /> Prices in Kenyan shillings (KES)</span></div>
  </div></footer>;
}
