import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { currentUser } from "@/lib/auth";
import { adminDashboard } from "@/lib/financial";

export const metadata: Metadata = { title: "Private admin dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "admin") notFound();
  return <main id="main-content" className="site-container interior-page"><AdminPanel initial={await adminDashboard()}/></main>;
}
