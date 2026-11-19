import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Eyebrow } from "@/components/blocks";
import { SavedView } from "@/components/saved-view";
export const metadata: Metadata = { title: "Saved listings", robots: { index: false } };
export default function SavedPage() { return <main id="main-content" className="site-container interior-page"><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><strong>Saved listings</strong></nav><section className="inner-banner"><div><Eyebrow>YOUR SHORTLIST</Eyebrow><h1>Saved listings</h1><p>Keep everything you like in one place.</p></div><Heart className="banner-icon" size={100} strokeWidth={.9}/></section><section className="sub-section"><SavedView/></section></main>; }
