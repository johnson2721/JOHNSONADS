"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { api } from "@/lib/client";

export function Gallery({ images, title, slug }: { images: string[]; title: string; slug: string }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => { void api(`/api/listings/${encodeURIComponent(slug)}/view`, "POST").catch(() => {}); }, [slug]);
  return <div className="detail-gallery"><div className="gallery-main">{images.length ? <img src={images[current] ?? images[0]} alt={`${title}${images.length > 1 ? `, photo ${current + 1}` : ""}`} /> : <div className="listing-placeholder"><ImageIcon size={60} strokeWidth={1.1}/></div>}</div>{images.length > 1 && <div className="gallery-thumbs">{images.map((image, i) => <button key={image} type="button" aria-pressed={current === i} aria-label={`Show photo ${i + 1}`} onClick={() => setCurrent(i)}><img src={image} alt="" /></button>)}</div>}</div>;
}
