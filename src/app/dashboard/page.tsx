import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { clientUser, currentUser } from "@/lib/auth";
import { myDashboard } from "@/lib/marketplace";

export const metadata: Metadata = { title: "My dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const tabs = ["overview", "listings", "orders", "inbox", "subscriptions", "payments", "activity", "profile"] as const;
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string }> }) {
  const input = await searchParams;
  const tab = tabs.find((key) => key === input.tab) || "overview";
  const addNew = tab === "listings" && input.new === "1";
  const user = await currentUser();
  if (!user) redirect(`/account/login?${new URLSearchParams({ next: `/dashboard${tab !== "overview" ? `?tab=${tab}${addNew ? "&new=1" : ""}` : ""}` })}`);
  const data = await myDashboard(user);
  return <main id="main-content" className="site-container interior-page"><Dashboard key={`${tab}:${addNew}`} initial={data} tab={tab} user={clientUser(user)} addNew={addNew}/></main>;
}
