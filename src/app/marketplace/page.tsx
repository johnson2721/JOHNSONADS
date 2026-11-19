import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Filter, MapPin, Search, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { CategoryIcons, Empty, Eyebrow, ListingGrid, ServiceGrid, TextLink } from "@/components/blocks";
import { CategoryCommunity, CategoryFeedLinks } from "@/components/category-community";
import { publicCategory } from "@/lib/editorial";
import { CATEGORIES, LOCATIONS, SERVICES } from "@/lib/catalog";
import { categoryUrl } from "@/lib/client";
import { findListings } from "@/lib/public-data";

export const metadata: Metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";
export default async function Marketplace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const get = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const q = get("q")?.trim().slice(0, 100) || "", location = get("location")?.trim().slice(0, 80) || "", min = get("min")?.slice(0, 9) || "", max = get("max")?.slice(0, 9) || "", sort = get("sort") || "featured";
  const category = CATEGORIES.find((item) => item.key === get("category"));
  const [{ items, total, page }, feed] = await Promise.all([findListings({ q, kind: category?.key, location, min, max, sort, page: Math.trunc(Number(get("page"))) || 1 }), category ? publicCategory(category.key) : null]);
  const Icon = category ? CategoryIcons[category.key] : ShoppingBag;
  const pagination = (p: number) => `/marketplace?${new URLSearchParams(Object.entries({ q, location, min, max, sort, category: category?.key ?? "", page: String(p) }).filter(([, value]) => value))}`;
  const serviceHits = !category && q.length > 1 ? SERVICES.filter((s) => `${s.name} ${s.text}`.toLowerCase().includes(q.toLowerCase())) : [];
  return <main id="main-content" className="site-container interior-page">
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span>{category ? <><Link href="/marketplace">Marketplace</Link><span>/</span><strong>{category.name}</strong></> : <strong>Marketplace</strong>}</nav>
    <section className={`inner-banner ${feed?.settings?.coverId ? "category-banner-photo" : ""}`}><div><Eyebrow>JOHNSON DIGITAL EMPIRE</Eyebrow><h1>{feed?.settings?.heading || category?.name || "Explore the marketplace"}</h1><p>{feed?.settings?.summary || category?.description || "Shop products, find local businesses and discover opportunities across Kenya."}</p></div>{feed?.settings?.coverId ? <img src={`/api/media/${feed.settings.coverId}`} alt={feed.settings.coverAlt} /> : <Icon className="banner-icon" size={100} strokeWidth={.85}/>}</section>
    {feed && <CategoryFeedLinks feed={feed}/>}
    <div className="market-layout" id="category-listings">
      <aside className="market-sidebar"><h2><SlidersHorizontal size={18}/> Filter listings</h2>
        <form action="/marketplace" method="get" role="search" className="form-stack filter-form">
          <label><span>Search</span><div className="input-with-icon"><Search size={17}/><input name="q" placeholder="What are you looking for?" maxLength={100} defaultValue={q} type="search" /></div></label>
          <label>Category<select name="category" defaultValue={category?.key ?? ""}><option value="">All categories</option>{CATEGORIES.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}</select></label>
          <label>Location<div className="input-with-icon"><MapPin size={17}/><input name="location" defaultValue={location} placeholder="Anywhere in Kenya" maxLength={80} list="locations" /><datalist id="locations">{LOCATIONS.map((city) => <option key={city} value={city}/>)}</datalist></div></label>
          <fieldset><legend>Price range (KSh)</legend><div className="form-cols"><input name="min" aria-label="Minimum price" type="number" min={0} max={500000000} placeholder="Min" defaultValue={min} /><input name="max" aria-label="Maximum price" type="number" min={0} max={500000000} placeholder="Max" defaultValue={max}/></div></fieldset>
          <label>Sort by<select name="sort" defaultValue={sort}><option value="featured">Featured first</option><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label>
          <button className="button button-gold" type="submit"><Filter size={15}/> Apply filters</button>
          {(q || category || location || min || max || sort !== "featured") && <Link href="/marketplace" className="filter-clear">Clear filters</Link>}
        </form>
      </aside>
      <section className="market-results">
        <nav className="chip-nav" aria-label="Browse categories"><Link href="/marketplace" className={!category ? "selected" : ""}>All listings</Link>{CATEGORIES.map((item) => <Link href={categoryUrl(item.key)} key={item.key} className={category?.key === item.key ? "selected" : ""}>{item.name}</Link>)}</nav>
        {(category?.key === "web-design" || category?.key === "services" || category?.key === "advertising") && <div className="context-panel"><div><h3>{category.key === "web-design" ? "Need a website for your business?" : category.key === "advertising" ? "Put your listing in front of more people" : "Work with a professional"}</h3><p>{category.key === "advertising" ? "Find a promotion package that works for you." : "Tell us about your project and request a quotation."}</p></div><TextLink diagonal href={category.key === "web-design" ? "/contact?type=service&service=website-development" : category.key === "advertising" ? "/pricing" : "/services"}>{category.key === "web-design" ? "Get a quote" : category.key === "advertising" ? "View packages" : "View services"}</TextLink></div>}
        {category?.key === "services" && !items.length && !q && !location && !min && !max && <div className="market-services"><ServiceGrid /></div>}
        {serviceHits.length > 0 && <div className="context-panel"><div><h3>Matching professional services</h3>{serviceHits.map((service) => <div key={service.slug}><TextLink href={`/contact?type=service&service=${service.slug}`}>{service.name}</TextLink></div>)}</div></div>}
        <div className="results-title"><div><h2>{q ? `Results for “${q}”` : category?.name || "All listings"}</h2><p>{total} {total === 1 ? "listing" : "listings"}{location && ` in ${location}`}</p></div><Link href="/dashboard?tab=listings&new=1" className="text-link">Post a listing <ArrowUpRight size={16}/></Link></div>
        {items.length ? <ListingGrid items={items}/> : <Empty title="No listings found" text="Try another category, a wider location or a different search term." href="/marketplace" action="Browse all listings" icon={Search} />}
        {(page > 1 || total > page * 24) && <nav className="pagination" aria-label="Result pages">{page > 1 ? <Link className="button button-outline button-sm" href={pagination(page - 1)}><ArrowLeft size={16}/> Previous</Link> : <span /> }<span>Page {page}</span>{total > page * 24 ? <Link className="button button-outline button-sm" href={pagination(page + 1)}>Next <ArrowRight size={16}/></Link> : <span />}</nav>}
      </section>
    </div>
    {feed && category && <CategoryCommunity feed={feed} category={category.key}/>}
  </main>;
}
