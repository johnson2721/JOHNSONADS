import Link from "next/link";
import { BadgeCheck, Megaphone, MessagesSquare, Store } from "lucide-react";
import { ListingGrid } from "./blocks";
import { CategoryCommentForm } from "./category-comment-form";
import type { publicCategory } from "@/lib/editorial";
import { dateLabel } from "@/lib/catalog";

type Feed = Awaited<ReturnType<typeof publicCategory>>;
export function CategoryCommunity({ feed, category }: { feed: Feed; category: string }) {
  return <div className="category-community">
    {!!(feed.settings?.description || feed.updates.length) && <section className="panel community-panel" id="updates">
      <div className="community-heading"><span className="category-icon"><Megaphone size={19}/></span><div><h2>Category updates</h2><p>News and notes from Johnson Digital Empire.</p></div></div>
      {feed.settings?.description && <p className="preserve community-about">{feed.settings.description}</p>}
      {!!feed.updates.length && <div className="category-update-feed">{feed.updates.map((entry) => <article className={`category-story ${entry.photoId ? "has-photo" : ""}`} key={entry.id}>{entry.photoId && <img src={`/api/media/${entry.photoId}`} alt={entry.photoAlt} loading="lazy"/>}<div><time>{entry.date ? dateLabel(entry.date) : "Marketplace update"}</time><h3>{entry.title}</h3><p className="preserve">{entry.body}</p></div></article>)}</div>}
    </section>}
    {feed.sellers.length > 0 && <section id="seller-profiles" className="community-sellers"><div className="community-heading"><span className="category-icon"><Store size={20}/></span><div><h2>Seller spotlight</h2><p>Meet businesses connected to this category.</p></div></div><ListingGrid items={feed.sellers}/></section>}
    <section className="panel community-panel" id="comments"><div className="community-heading"><span className="category-icon"><MessagesSquare size={20}/></span><div><h2>Category discussion</h2><p>Share feedback and see what the community is saying.</p></div></div>
      {feed.comments.length ? <div className="category-comments">{feed.comments.map((comment) => <article key={comment.id}><span className="comment-avatar" aria-hidden="true">{[...comment.name][0] ?? "J"}</span><div><header><strong>{comment.name}</strong>{comment.staff && <span className="comment-staff"><BadgeCheck size={13}/> Staff</span>}<time>{dateLabel(comment.date)}</time></header><p className="preserve">{comment.body}</p></div></article>)}</div> : <p className="category-discussion-note">No published comments yet.</p>}
      <CategoryCommentForm key={category} category={category} enabled={feed.settings?.commentsEnabled !== false}/>
    </section>
  </div>;
}
export function CategoryFeedLinks({ feed }: { feed: Feed }) {
  return <nav className="category-jumps" aria-label="On this category page"><Link href="#category-listings">Listings</Link>{(feed.settings?.description || feed.updates.length > 0) && <Link href="#updates">Updates</Link>}{feed.sellers.length > 0 && <Link href="#seller-profiles">Seller spotlight</Link>}<Link href="#comments">Discussion</Link></nav>;
}
