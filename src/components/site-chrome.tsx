"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { Brand, Header } from "./navigation";

export function SiteChrome({ announcement, footer, children }: { announcement?: string; footer: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const privatePage = path === "/admin" || path === "/admin/login";
  return <>{privatePage ? <header className="private-masthead"><a className="skip-link" href="#main-content">Skip to content</a><div className="site-container"><Brand/><span className="private-badge"><LockKeyhole size={14}/> Private workspace</span><Link className="button button-outline button-sm" href="/" target="_blank" rel="noopener noreferrer">View marketplace <ArrowUpRight size={16}/></Link></div></header> : <Header announcement={announcement}/ >}{children}{!privatePage && footer}</>;
}
