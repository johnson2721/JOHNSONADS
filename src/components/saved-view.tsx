"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { Empty, ListingGrid } from "./blocks";
import { useMarket } from "./navigation";
import { api, errorText } from "@/lib/client";
import type { CardListing } from "@/lib/catalog";

export function SavedView() {
  const { user, saved, ready } = useMarket();
  const [state, setState] = useState<{ key: string; items?: CardListing[]; error?: string }>();
  const key = saved.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    const paths = user ? ["/api/saved"] : key.split(",").reduce<string[][]>((groups, value, i) => { if (i % 16 === 0) groups.push([]); groups[groups.length - 1].push(value); return groups; }, []).map((values) => `/api/listings?slugs=${encodeURIComponent(values.join(","))}`);
    void Promise.all(paths.map((path) => api<{ items: CardListing[] }>(path))).then((all) => { if (live) setState({ key, items: all.flatMap((result) => result.items) }); }).catch((error) => { if (live) setState({ key, error: errorText(error) }); });
    return () => { live = false; };
  }, [key, user]);
  if (!ready || (key && state?.key !== key && !state?.items)) return <div className="panel loading-panel" role="status">Loading your saved listings…</div>;
  if (key && state?.error && state.key === key) return <p className="form-error" role="alert">{state.error}</p>;
  const items = key ? state?.items?.filter((item) => saved.includes(item.slug)) : [];
  return items?.length ? <ListingGrid items={items}/> : <Empty title="No saved listings yet" text="Tap the heart on a listing to keep it here and come back to it anytime." href="/marketplace" action="Browse marketplace" icon={Heart}/>;
}
