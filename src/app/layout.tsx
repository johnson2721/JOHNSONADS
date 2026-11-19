import type { Metadata } from "next";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { content } from "@/db/schema";
import { clientUser, currentUser } from "@/lib/auth";
import { MarketProvider } from "@/components/navigation";
import { Footer } from "@/components/blocks";
import { SiteChrome } from "@/components/site-chrome";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./interior.css";
import "./workbench.css";
import "./publishing.css";

export const metadata: Metadata = {
  title: { default: "Johnson Digital Empire | Kenya’s Business Marketplace", template: "%s | Johnson Digital Empire" },
  description: "Connecting Businesses. Creating Opportunities. Growing Wealth. Discover products, property, local businesses and professional services across Kenya.",
  icons: { icon: "/jde.svg" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const [announcement] = await db.select({ value: content.value }).from(content).where(eq(content.key, "announcement")).catch(() => []);
  return <html lang="en-KE"><body><MarketProvider user={user ? clientUser(user) : null}><SiteChrome announcement={announcement?.value} footer={<Footer/>}>{children}</SiteChrome></MarketProvider></body></html>;
}
