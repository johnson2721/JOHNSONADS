import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, Building2, ChevronDown, CircleHelp, Flame, Globe2, MapPin, Megaphone, Search, ShieldCheck, Sparkles } from "lucide-react";
import { CategoryGrid, Empty, Eyebrow, ListingGrid, Plans, ServiceGrid, TextLink, TrustStrip } from "@/components/blocks";
import { LOCATIONS, TAGLINE } from "@/lib/catalog";
import { getHomeData } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { trending, businesses, property, vehicles, featured, plans, content } = await getHomeData();
  return <main id="main-content">
    <div className="site-container home-main">
      <section className="hero" aria-labelledby="hero-title">
        <Image src={content.homepageCover ? `/api/media/${content.homepageCover}` : "/images/nairobi-skyline.jpg"} alt={content.homepageCover ? content.homepageCoverAlt || "" : ""} unoptimized={Boolean(content.homepageCover)} fill sizes="(max-width: 760px) 100vw, 1280px" preload className="hero-photo" />
        <div className="hero-shade" />
        <div className="hero-inner">
          <div className="hero-kicker"><i /> KENYA’S DIGITAL MARKETPLACE</div>
          <h1 id="hero-title">Where business<br/><em>meets opportunity.</em></h1>
          <p>{content.heroNote || TAGLINE}</p>
          <form action="/marketplace" method="get" className="hero-search" role="search">
            <label className="hero-input"><Search size={21} aria-hidden="true" /><span className="sr-only">Search the marketplace</span><input name="q" type="search" maxLength={100} placeholder="Search products, services, property..." /></label>
            <label className="hero-location"><MapPin size={17} aria-hidden="true" /><span className="sr-only">Filter by location</span><select name="location" aria-label="Filter by location"><option value="">All Kenya</option>{LOCATIONS.map((place) => <option key={place}>{place}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>
            <button className="button button-gold" type="submit">Search <ArrowRight size={17} /></button>
          </form>
          <div className="hero-popular"><span>Popular:</span><Link href="/marketplace?category=products&q=electronics">Electronics</Link><Link href="/marketplace?category=property">Apartments</Link><Link href="/services?focus=website">Website Design</Link></div>
        </div>
        {!content.homepageCover && <span className="skyline-caption"><MapPin size={16} /> NAIROBI, KENYA</span>}
      </section>

      <section className="home-categories" id="categories">
        <div className="section-header"><div><Eyebrow>FIND YOUR NEXT OPPORTUNITY</Eyebrow><h2>Explore by category</h2><p>Everything you need to do business, all in one place.</p></div><TextLink href="/marketplace" diagonal>View all categories</TextLink></div>
        <CategoryGrid />
      </section>

      <section className="home-trending" aria-labelledby="trending-heading">
        <div className="section-header"><div><h2 id="trending-heading" className="heading-with-icon"><span><Flame size={22}/></span> Trending now</h2><p>Fresh finds and featured listings from across the marketplace.</p></div><TextLink href="/marketplace">View marketplace</TextLink></div>
        {trending.length ? <ListingGrid items={trending} /> : <Empty title="Be the first to list" text="We’re opening our marketplace to businesses across Kenya." href="/dashboard?tab=listings&new=1" action="Start selling" />}
      </section>

      <TrustStrip />

      <section className="home-section" id="businesses">
        <div className="section-header"><div><Eyebrow>MEET THE COMMUNITY</Eyebrow><h2>Featured businesses</h2><p>Discover the independent brands and teams building what’s next.</p></div><TextLink href="/marketplace?category=businesses">Explore businesses</TextLink></div>
        {businesses.length ? <div className="business-grid">{businesses.map((item) => <Link href={`/marketplace/${item.slug}`} key={item.slug} className="business-tile">
          <div className="business-photo">{item.images[0] && <Image src={item.images[0]} alt="" fill sizes="(max-width: 760px) 100vw, 43vw" unoptimized={item.images[0].startsWith("/api/")} />}</div><div className="business-info"><span className="category-icon"><Building2 size={21} /></span><div><h3>{item.title}</h3><p>{item.category} · {item.location}</p></div><ArrowUpRight size={19} /></div></Link>)}</div> : <Empty title="Showcase your business" text="Create a business profile to introduce your work to the marketplace." href="/dashboard?tab=listings&new=1" action="List your business" />}
      </section>

      <section className="growth-banner" id="about">
        <div className="growth-decoration" aria-hidden="true"><Globe2 size={285} strokeWidth={.35} /></div>
        <div><Eyebrow>BUILT FOR AMBITIOUS BUSINESSES</Eyebrow><h2>Put your business<br/>in the <em>spotlight.</em></h2><p>{content.aboutNote || "From your first listing to your next big campaign, reach customers, build your brand and grow on your terms."}</p><div className="button-row"><Link className="button button-gold" href="/dashboard?tab=listings&new=1">Start Selling <ArrowUpRight size={17}/></Link><Link className="button button-dark-outline" href="/pricing">Explore advertising <ArrowRight size={17} /></Link></div></div>
        <div className="growth-promos">{[[Megaphone, "Get discovered", "Promote listings and get more visibility."], [Sparkles, "Make a great first impression", "Showcase your work with a business profile."], [ShieldCheck, "Trade with confidence", "Secure accounts and verified payments."]].map(([Icon, title, text]) => { const Symbol = Icon as typeof Megaphone; return <div key={title as string}><span><Symbol size={22} /></span><div><strong>{title as string}</strong><small>{text as string}</small></div></div>; })}</div>
      </section>

      <section className="home-section" aria-labelledby="directory-heading">
        <div className="section-header"><div><Eyebrow>LOCAL DISCOVERY</Eyebrow><h2 id="directory-heading">Property, vehicles & more</h2><p>Find your next space, your next ride or your next great deal.</p></div><TextLink href="/marketplace?category=advertising">Featured advertisements</TextLink></div>
        {[...property, ...vehicles, ...featured].length ? <ListingGrid items={[...property.slice(0, 2), ...vehicles.slice(0, 2), ...featured].slice(0, 4)} /> : <Empty title="Explore the directory" text="New listings appear here as sellers join the marketplace." href="/marketplace" action="Browse the marketplace" />}
        <div className="inline-destinations"><TextLink href="/marketplace?category=property">View properties</TextLink><TextLink href="/marketplace?category=vehicles">View vehicles</TextLink>{featured[0] && <TextLink href={`/marketplace/${featured[0].slug}`}>Featured: {featured[0].title}</TextLink>}</div>
      </section>

      <section className="home-section"><div className="section-header"><div><Eyebrow>WORK WITH AN EXPERT</Eyebrow><h2>Popular professional services</h2><p>From a new website to a full campaign, get support for your next project.</p></div><TextLink href="/services">Explore services</TextLink></div><ServiceGrid /></section>
    </div>

    <section className="home-pricing" id="packages"><div className="site-container"><div className="section-header center-heading"><div><Eyebrow>ADVERTISING PACKAGES</Eyebrow><h2>Promote at your own pace</h2><p>Choose the visibility and support your business needs. Renew when you’re ready.</p></div></div><Plans plans={plans} /></div></section>

    <div className="site-container">
      <section className="home-section testimonials"><div className="section-header"><div><Eyebrow>BUILT AROUND YOUR GOALS</Eyebrow><h2>How businesses can use the marketplace</h2><p>Illustrative stories from a seller, a service client and a shopper.</p></div></div><div className="quote-grid">
        {[["I wanted one place to show my products and answer customer enquiries. A business profile gives me both.", "Independent seller"], ["I needed a website for my new business. I could describe my project and request a quote without committing to a package.", "Service client"], ["I like being able to look for a product or a rental in the same place and save the ones I want to revisit.", "Marketplace shopper"]].map(([quote, role]) => <figure key={role}><span className="quote-symbol">“</span><blockquote>{quote}</blockquote><figcaption>{role} <small>· Example scenario</small></figcaption></figure>)}
      </div></section>
      <section className="help-banner"><span className="category-icon"><CircleHelp size={26} /></span><div><h2>How can we help?</h2><p>Need support, a quote, or want to explore a partnership? We’re here to help.</p></div><Link href="/contact" className="button button-ink">Contact us <ArrowRight size={17}/></Link></section>
    </div>
  </main>;
}
