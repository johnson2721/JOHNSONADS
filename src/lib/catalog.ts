export const BRAND = "JOHNSON DIGITAL EMPIRE";
export const TAGLINE = "Connecting Businesses. Creating Opportunities. Growing Wealth.";
export const SUPPORT_EMAIL = "johnsonkanyiri0@gmail.com";
export const TARGET = 500_000;
export const CATEGORIES = [
  { key: "products", name: "Products", detail: "Shop the marketplace", description: "From everyday essentials to your next big upgrade." },
  { key: "businesses", name: "Businesses", detail: "Discover local brands", description: "Meet the businesses building Kenya’s next chapter." },
  { key: "services", name: "Services", detail: "Find an expert", description: "Find the right professionals for your next project." },
  { key: "property", name: "Property", detail: "Rent, buy or list", description: "Discover places to live, work and invest." },
  { key: "vehicles", name: "Vehicles", detail: "Find your next ride", description: "Find a new ride from local dealers and independent sellers." },
  { key: "jobs", name: "Jobs", detail: "Explore opportunities", description: "Make your next move or find your next great hire." },
  { key: "advertising", name: "Advertising", detail: "Get your brand seen", description: "Put your business in front of the right people." },
  { key: "web-design", name: "Web Design", detail: "Build your website", description: "Launch a digital home for your business." },
] as const;
export const KINDS = CATEGORIES.map((item) => item.key);
export const BUSINESS_CATEGORIES = ["Retail & Ecommerce", "Technology", "Professional Services", "Real Estate", "Automotive", "Hospitality & Food", "Creative & Media", "Education", "Other"];
export const COUNTRIES = ["Kenya", "Uganda", "Tanzania", "Rwanda", "Ethiopia", "South Africa", "Nigeria", "United Kingdom", "United States", "Other"];
export const LOCATIONS = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Remote"];
export const SERVICES = [
  { slug: "website-development", name: "Website development", text: "Fast, modern websites built to earn your customers’ trust." },
  { slug: "digital-marketing", name: "Digital marketing", text: "Reach the right audience with a strategy that works for you." },
  { slug: "social-media", name: "Social media management", text: "Build a consistent voice and connect with your community." },
  { slug: "branding", name: "Business branding", text: "Give your business an identity that customers remember." },
  { slug: "graphic-design", name: "Graphic design", text: "Make your next idea look as good as it sounds." },
  { slug: "advertisement-creation", name: "Advertisement creation", text: "Get campaign-ready creative for digital and print." },
  { slug: "consultancy", name: "Business consultancy", text: "Get practical, one-on-one support for your next decision." },
] as const;

export type Plan = { slug: string; name: string; description: string; price: number; days: number; slots: number; features: string[]; active: boolean; rank: number };
export const DEFAULT_PLANS: Plan[] = [
  { slug: "basic", name: "Basic", description: "A simple way to get noticed.", price: 500, days: 7, slots: 1, features: ["One featured advertisement", "Seven-day visibility"], active: true, rank: 1 },
  { slug: "business", name: "Business", description: "For businesses ready to grow.", price: 2000, days: 30, slots: 3, features: ["Business profile", "Multiple advertisements", "Priority visibility", "Business analytics"], active: true, rank: 2 },
  { slug: "premium", name: "Premium", description: "More visibility, more momentum.", price: 5000, days: 30, slots: 7, features: ["Premium business profile", "Featured advertisements", "Advanced analytics", "Priority promotion"], active: true, rank: 3 },
  { slug: "enterprise", name: "Enterprise", description: "A bigger stage for your brand.", price: 15000, days: 30, slots: 15, features: ["Professional business promotion", "Custom advertising campaigns", "Dedicated support", "Multiple business listings"], active: true, rank: 4 },
];

export type CardListing = { slug: string; title: string; description: string; kind: string; category: string; location: string; price: number | null; priceUnit: string; images: string[]; badge: string; example: boolean; managedCategory?: string | null; featured?: boolean };
type Seed = CardListing & { rank: number };
export const SAMPLE_LISTINGS: Seed[] = [
  { slug: "sony-wh-1000xm5-headphones", title: "Sony WH-1000XM5 Headphones", kind: "products", category: "Electronics", description: "Premium wireless headphones with adaptive noise cancellation, a lightweight fit and long battery life. This example shows how a Nairobi electronics seller can list a product.", location: "Nairobi, Kenya", price: 34500, priceUnit: "", images: ["/images/headphones.jpg"], badge: "Featured", example: true, rank: 100 },
  { slug: "modern-2-bedroom-apartment-westlands", title: "Modern 2-Bedroom Apartment", kind: "property", category: "For Rent", description: "A modern two-bedroom apartment with good natural light, a spacious balcony and secure access. Sample property listing in the Westlands area of Nairobi.", location: "Westlands, Nairobi", price: 85000, priceUnit: "/ month", images: ["/images/apartment.jpg"], badge: "For rent", example: true, rank: 99 },
  { slug: "toyota-land-cruiser-prado-2018", title: "Toyota Land Cruiser Prado 2018", kind: "vehicles", category: "SUVs", description: "A well-appointed Toyota Land Cruiser Prado with a spacious interior. This sample listing illustrates a vehicle advertisement; it isn’t an offer for a real car.", location: "Karen, Nairobi", price: 5800000, priceUnit: "", images: ["/images/suv.jpg"], badge: "", example: true, rank: 98 },
  { slug: "apple-macbook-air-m2", title: "Apple MacBook Air M2", kind: "products", category: "Computing", description: "A lightweight 13-inch laptop with the M2 chip. Ideal for everyday work, study and creative projects. Sample listing only.", location: "Kilimani, Nairobi", price: 125000, priceUnit: "", images: ["/images/laptop.jpg"], badge: "", example: true, rank: 97 },
  { slug: "nairobi-creative-studio", title: "Nairobi Creative Studio", kind: "businesses", category: "Creative & Media", description: "An independent studio concept for design, branding and digital storytelling. This is an example of a business profile on Johnson Digital Empire.", location: "Westlands, Nairobi", price: null, priceUnit: "", images: ["/images/studio.jpg"], badge: "Business", example: true, rank: 45 },
  { slug: "highland-coffee-collective", title: "Highland Coffee Collective", kind: "businesses", category: "Food & Drink", description: "An example profile for a specialty roaster celebrating coffee grown in Kenya, from bright single origins to rich house blends.", location: "Lavington, Nairobi", price: null, priceUnit: "", images: ["/images/coffee.jpg"], badge: "Business", example: true, rank: 44 },
  { slug: "creative-desk-co", title: "Creative Desk Co. Coworking", kind: "advertising", category: "Coworking", description: "A sample advertisement for flexible desk space and modern meeting rooms for small teams.", location: "Nairobi, Kenya", price: 18000, priceUnit: "/ month", images: ["/images/studio.jpg"], badge: "Featured", example: true, rank: 43 },
  { slug: "digital-marketing-associate", title: "Digital Marketing Associate", kind: "jobs", category: "Full-time", description: "Example employment listing for a creative marketing role. This is not an active job vacancy.", location: "Nairobi, Kenya", price: null, priceUnit: "", images: ["/images/studio.jpg"], badge: "Full-time", example: true, rank: 42 },
];

export function money(value: number) { return "KSh " + new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(value); }
export function dateLabel(value: string | Date) { return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(value)); }
export function categoryName(key: string) { return CATEGORIES.find((item) => item.key === key)?.name ?? key; }
export const METHOD_LABELS = { mpesa: "M-Pesa", paypal: "PayPal", binance: "Binance Pay", lipwa: "Lipwa" } as const;
export const LISTING_ACTIVITY: Record<string, string> = { products: "New product listing", businesses: "New business advertisement", services: "New service listing", property: "New property listing", vehicles: "New vehicle listing", jobs: "New employment advertisement", advertising: "New business advertisement", "web-design": "New service listing" };
