"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, ChevronRight, Eye, EyeOff, ImagePlus, Layers3, LayoutTemplate, Megaphone, MessagesSquare, Plus, RefreshCw, Send, Store, Trash2, Upload, X, type LucideIcon } from "lucide-react";
import { CATEGORIES, categoryName, dateLabel } from "@/lib/catalog";
import { api, categoryUrl, errorText, field } from "@/lib/client";
import type { categoryWorkspace } from "@/lib/editorial";
import { CategoryIcons } from "./blocks";
import { useMarket } from "./navigation";
import { InlineEmpty, Status } from "./workbench";

export type EditorialData = Awaited<ReturnType<typeof categoryWorkspace>>;
type Settings = EditorialData["settings"];
type Update = EditorialData["updates"][number];
type Seller = EditorialData["sellers"][number];
type Section = "design" | "updates" | "sellers" | "comments";
type Action = (path: string, method: "POST" | "PATCH" | "DELETE", data: unknown, message: string) => Promise<boolean>;
const viewTabs: { key: Section; name: string; icon: LucideIcon }[] = [
  { key: "design", name: "Page & cover", icon: LayoutTemplate }, { key: "updates", name: "Updates", icon: Megaphone }, { key: "sellers", name: "Seller profiles", icon: Store }, { key: "comments", name: "Comments", icon: MessagesSquare },
];
export function EditorialWorkspace() {
  const [key, setKey] = useState<string>(CATEGORIES[0].key);
  const [view, setView] = useState<Section>("design");
  return <section className="editorial-workspace" aria-label="Category publishing workspace">
    <div className="editorial-intro panel"><div><span className="eyebrow"><i/> PUBLISHING STUDIO</span><h2>Category manager</h2><p>Update category pages, showcase new sellers, and moderate the conversations on your marketplace.</p></div><span className="intro-mark"><Layers3 size={34} strokeWidth={1.3}/></span></div>
    <div className="editorial-categories" aria-label="Choose a category">{CATEGORIES.map((category) => { const Icon = CategoryIcons[category.key]; return <button key={category.key} type="button" aria-pressed={key === category.key} onClick={() => setKey(category.key)}><span><Icon size={18}/></span><strong>{category.name}</strong><ChevronRight className="category-chevron" size={14}/></button>; })}</div>
    <CategoryEditor key={key} category={key} view={view} setView={setView}/>
  </section>;
}
function CategoryEditor({ category, view, setView }: { category: string; view: Section; setView: (next: Section) => void }) {
  const [data, setData] = useState<EditorialData>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const { toast } = useMarket();
  const root = `/api/admin/categories/${category}`;
  useEffect(() => {
    let live = true;
    void api<EditorialData>(root).then((result) => { if (live) setData(result); }).catch((failure) => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
  }, [root, revision]);
  const act: Action = async (url, method, values, message) => {
    setError(""); setBusy(true);
    try { await api(url, method, values); setData(await api<EditorialData>(root)); toast(message); return true; }
    catch (failure) { setError(errorText(failure)); return false; }
    finally { setBusy(false); }
  };
  const pending = data?.comments.filter((row) => row.status === "pending").length ?? 0;
  return <div className="panel editorial-body"><div className="editorial-title"><div><h2>{categoryName(category)}</h2><p>{data ? `${data.updates.filter((row) => row.status === "published").length} published updates · ${data.sellers.filter((row) => row.status === "approved").length} live seller profiles · ${pending} comments to review` : "Manage what appears on this category’s public page."}</p></div><Link href={categoryUrl(category)} target="_blank" rel="noopener noreferrer" className="button button-outline button-sm"><Eye size={15}/> View public page <ArrowUpRight size={15}/></Link></div>
    <div className="editorial-tabs" aria-label="Category settings sections">{viewTabs.map(({ key, name, icon: Icon }) => <button key={key} aria-pressed={key === view} onClick={() => { setError(""); setView(key); }} type="button"><Icon size={16}/>{name}{key === "comments" && pending > 0 && <span>{pending}</span>}</button>)}</div>
    {error && <p className="form-error editorial-error" role="alert">{error}</p>}
    {!data ? error ? <button type="button" className="button button-outline button-sm" onClick={() => { setError(""); setRevision(revision + 1); }}><RefreshCw size={14}/> Retry</button> : <p className="inline-empty" role="status">Loading {categoryName(category).toLowerCase()} workspace…</p> : view === "design" ? <CategoryDesign item={data.settings} category={category} url={root} act={act} busy={busy}/> : view === "updates" ? <Updates rows={data.updates} root={root} act={act} busy={busy}/> : view === "sellers" ? <Sellers rows={data.sellers} root={root} act={act} busy={busy}/> : <Comments rows={data.comments} root={root} act={act} busy={busy}/>}
  </div>;
}
function CategoryDesign({ item, category, url, act, busy }: { item: Settings; category: string; url: string; act: Action; busy: boolean }) {
  const [photo, setPhoto] = useState(item?.coverId ?? null), [uploading, setUploading] = useState(false);
  const fallback = CATEGORIES.find((choice) => choice.key === category);
  return <form className="form-stack category-design" method="post" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void act(url, "PATCH", { heading: field(data, "heading"), summary: field(data, "summary"), description: field(data, "description"), coverId: photo, coverAlt: photo ? field(data, "coverAlt") : "", commentsEnabled: data.has("commentsEnabled") }, "Category page published"); }}>
    <div className="editorial-form-split"><div className="form-stack"><label>Page heading<input name="heading" placeholder={fallback?.name} defaultValue={item?.heading} maxLength={85}/></label><label>Short introduction<textarea name="summary" placeholder={fallback?.description} defaultValue={item?.summary} maxLength={230} rows={2}/></label><label>About this category<textarea name="description" placeholder="Give visitors more information about this category…" defaultValue={item?.description} maxLength={2000} rows={5}/></label><label className="check-row"><input type="checkbox" name="commentsEnabled" defaultChecked={item?.commentsEnabled !== false}/> Allow new community comments</label></div><div className="form-stack"><PhotoPicker label="Category cover photo" photo={photo} setPhoto={setPhoto} onBusy={setUploading}/>{photo && <label>Image description<input name="coverAlt" defaultValue={item?.coverAlt} maxLength={140} required placeholder="Describe what’s in the cover photo"/></label>}</div></div>
    <div className="editorial-actions"><p className="form-note">Changes go live when you publish. Blank heading and introduction fields use their defaults.</p><button type="submit" className="button button-gold" disabled={busy || uploading}><Check size={17}/>{busy ? "Publishing…" : "Publish category page"}</button></div>
  </form>;
}
export function PhotoPicker({ label, photo, setPhoto, onBusy }: { label: string; photo: string | null; setPhoto: (newPhoto: string | null) => void; onBusy: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const select = async (file?: File) => {
    if (!file) return;
    setError(""); setBusy(true); onBusy(true);
    try { if (file.size > 5 * 1024 * 1024) throw new Error("Choose a photo smaller than 5 MB."); const result = await api<{ id: string }>("/api/media", "POST", file); setPhoto(result.id); }
    catch (failure) { setError(errorText(failure)); }
    finally { onBusy(false); setBusy(false); }
  };
  return <fieldset className="editorial-photo"><legend>{label}</legend><div className={`editorial-preview ${photo ? "with-image" : ""}`}>{photo ? <img src={`/api/media/${photo}`} alt="Selected photo preview"/> : <div><span className="category-icon"><ImagePlus size={24}/></span><strong>No custom photo</strong><small>Choose a JPG, PNG or WebP up to 5 MB.</small></div>}{photo && <button type="button" aria-label={`Remove ${label.toLowerCase()}`} disabled={busy} onClick={() => setPhoto(null)}><X size={16}/></button>}</div><label className="editorial-upload"><Upload size={15}/><span>{busy ? "Uploading…" : photo ? "Replace photo" : "Upload a photo"}</span><input type="file" aria-label={label} accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { void select(e.target.files?.[0]); e.target.value = ""; }}/></label>{error && <p className="form-error" role="alert">{error}</p>}</fieldset>;
}
function Updates({ rows, root, act, busy }: { rows: Update[]; root: string; act: Action; busy: boolean }) {
  const [selected, edit] = useState<Update | "new" | null>(null);
  return <div><div className="editorial-subhead"><div><h3>Category updates</h3><p>Write announcements or add news and photos to this category.</p></div><button type="button" className="button button-gold button-sm" onClick={() => edit("new")}><Plus size={16}/> New update</button></div>
    {selected && <UpdateEditor key={selected === "new" ? "new" : selected.id} item={selected === "new" ? undefined : selected} url={`${root}/updates`} act={act} close={() => edit(null)} busy={busy}/>}
    {rows.length ? <div className="editorial-records">{rows.map((row) => <article className="editorial-record" key={row.id}><div>{row.photoId && <img src={`/api/media/${row.photoId}`} alt="" loading="lazy"/>}<div><h3>{row.title}</h3><p>{dateLabel(row.updatedAt)} · {row.body.slice(0, 105)}{row.body.length > 105 ? "…" : ""}</p><Status value={row.status}/></div></div><div className="button-row"><button className="button button-outline button-sm" type="button" onClick={() => edit(row)}>Edit update</button><button className="button button-outline button-sm danger-text" type="button" aria-label={`Delete ${row.title}`} disabled={busy} onClick={() => { if (window.confirm("Remove this update from the category?")) void act(`${root}/updates/${row.id}`, "DELETE", undefined, "Update removed").then((done) => { if (done && selected !== "new" && selected?.id === row.id) edit(null); }); }}><Trash2 size={15}/></button></div></article>)}</div> : !selected && <InlineEmpty>No updates yet. Create an update and publish it when you’re ready.</InlineEmpty>}
  </div>;
}
function UpdateEditor({ item, url, close, act, busy }: { item?: Update; url: string; close: () => void; act: Action; busy: boolean }) {
  const [photo, setPhoto] = useState(item?.photoId ?? null), [uploading, setUploading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "publish" ? "published" : "draft";
    if (await act(item ? `${url}/${item.id}` : url, item ? "PATCH" : "POST", { title: field(data, "title"), body: field(data, "body"), photoId: photo, photoAlt: photo ? field(data, "alt") : "", status }, status === "published" ? "Update published" : "Update saved as a draft")) close();
  };
  return <form className="form-stack editor-box" method="post" onSubmit={submit}><EditorHeader title={item ? "Edit category update" : "Create category update"} close={close}/><div className="editorial-form-split"><div className="form-stack"><label>Update title<input name="title" defaultValue={item?.title} minLength={3} maxLength={100} required/></label><label>Update text<textarea name="body" defaultValue={item?.body} minLength={5} maxLength={3000} rows={6} required/></label></div><div className="form-stack"><PhotoPicker label="Update photo" photo={photo} setPhoto={setPhoto} onBusy={setUploading}/>{photo && <label>Image description<input name="alt" defaultValue={item?.photoAlt} maxLength={140} required/></label>}</div></div><EditorButtons noun="update" disabled={busy || uploading}/></form>;
}
function Sellers({ rows, root, act, busy }: { rows: Seller[]; root: string; act: Action; busy: boolean }) {
  const [selected, edit] = useState<Seller | "new" | null>(null);
  return <div><div className="editorial-subhead"><div><h3>Seller profiles</h3><p>Add a public seller profile without creating a sign-in account for the seller.</p></div><button type="button" className="button button-gold button-sm" onClick={() => edit("new")}><Plus size={16}/> Add seller</button></div>
    {selected && <SellerEditor key={selected === "new" ? "new" : selected.id} item={selected === "new" ? undefined : selected} url={`${root}/sellers`} act={act} close={() => edit(null)} busy={busy}/>}
    {rows.length ? <div className="editorial-records">{rows.map((row) => <article className="editorial-record" key={row.id}><div>{row.images[0] && <img src={row.images[0]} alt="" loading="lazy"/>}<div><h3>{row.title}</h3><p>{row.category} · {row.location}</p><Status value={row.status === "approved" ? "published" : row.status}/></div></div><div className="button-row">{row.status === "approved" && <Link className="button button-outline button-sm" href={`/marketplace/${row.slug}`} target="_blank" rel="noopener noreferrer">View <ArrowUpRight size={14}/></Link>}<button className="button button-outline button-sm" type="button" onClick={() => edit(row)}>Edit seller</button><button className="button button-outline button-sm danger-text" type="button" aria-label={`Archive ${row.title}`} disabled={busy} onClick={() => { if (window.confirm("Archive this seller profile? It will no longer appear publicly.")) void act(`${root}/sellers/${row.id}`, "DELETE", undefined, "Seller profile archived").then((done) => { if (done && selected !== "new" && selected?.id === row.id) edit(null); }); }}><Trash2 size={15}/></button></div></article>)}</div> : !selected && <InlineEmpty>No seller profiles yet. Add the first business for this category.</InlineEmpty>}
  </div>;
}
function SellerEditor({ item, url, close, act, busy }: { item?: Seller; url: string; close: () => void; act: Action; busy: boolean }) {
  const [photo, setPhoto] = useState(item?.images[0]?.split("/").at(-1) || null), [uploading, setUploading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "publish" ? "approved" : "draft";
    if (await act(item ? `${url}/${item.id}` : url, item ? "PATCH" : "POST", { name: field(data, "name"), category: field(data, "category"), location: field(data, "location"), description: field(data, "description"), website: field(data, "website"), photoId: photo, status }, status === "approved" ? "Seller profile published" : "Seller profile draft saved")) close();
  };
  return <form className="form-stack editor-box" method="post" onSubmit={submit}><EditorHeader title={item ? "Edit seller profile" : "Add seller profile"} close={close}/><div className="editorial-form-split"><div className="form-stack"><label>Seller or business name<input name="name" defaultValue={item?.title} minLength={2} maxLength={100} required/></label><div className="form-cols"><label>Specialty<input name="category" defaultValue={item?.category} minLength={2} maxLength={60} placeholder="e.g. Fashion retailer" required/></label><label>Location<input name="location" defaultValue={item?.location || "Nairobi, Kenya"} minLength={2} maxLength={90} required/></label></div><label>Seller description<textarea name="description" defaultValue={item?.description} minLength={15} maxLength={5000} rows={5} required/></label><label>Public website <small>(optional)</small><input name="website" type="url" defaultValue={item?.sellerWebsite} placeholder="https://example.com" maxLength={250}/></label></div><PhotoPicker label="Seller photo" photo={photo} setPhoto={setPhoto} onBusy={setUploading}/></div><p className="form-note">Publish only business details and photos you have permission to share. Enquiries go to marketplace support.</p><EditorButtons noun="seller profile" disabled={busy || uploading}/></form>;
}
function Comments({ rows, root, act, busy }: { rows: EditorialData["comments"]; root: string; act: Action; busy: boolean }) {
  const [filter, setFilter] = useState("all");
  const [compose, setCompose] = useState(false);
  const visible = filter === "all" ? rows : rows.filter((row) => row.status === filter);
  return <div><div className="editorial-subhead"><div><h3>Category comments</h3><p>Approve or hide community comments. Staff messages publish immediately.</p></div><button type="button" className="button button-gold button-sm" onClick={() => setCompose(!compose)}><Plus size={16}/> Staff comment</button></div>
    {compose && <form className="form-stack editor-box" method="post" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; if (await act(`${root}/comments`, "POST", { body: field(new FormData(form), "body") }, "Staff comment published")) { form.reset(); setCompose(false); } }}><EditorHeader title="Post as Johnson Digital Empire" close={() => setCompose(false)}/><label>Staff comment<textarea name="body" rows={4} minLength={3} maxLength={1000} required/></label><button className="button button-gold align-start" type="submit" disabled={busy}><Send size={16}/> Publish staff comment</button></form>}
    <div className="editorial-filter"><label htmlFor="moderation-filter">Show</label><select id="moderation-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All comments</option><option value="pending">Needs review</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></div>
    {visible.length ? <div className="editorial-records">{visible.map((row) => <article className="editorial-record editorial-comment" key={row.id}><div><div><h3>{row.displayName}{row.staff && <span className="comment-staff">Staff</span>}</h3><p>{dateLabel(row.createdAt)} <Status value={row.status}/></p><p className="preserve">{row.body}</p></div></div><div className="button-row">{row.status !== "visible" && <button type="button" className="button button-outline button-sm" disabled={busy} onClick={() => act(`${root}/comments/${row.id}`, "PATCH", { status: "visible" }, "Comment published")}><Check size={15}/> {row.status === "pending" ? "Approve" : "Show"}</button>}{row.status !== "hidden" && <button type="button" className="button button-outline button-sm" disabled={busy} onClick={() => act(`${root}/comments/${row.id}`, "PATCH", { status: "hidden" }, "Comment hidden")}><EyeOff size={15}/> Hide</button>}</div></article>)}</div> : <InlineEmpty>No comments in this view.</InlineEmpty>}
  </div>;
}
function EditorHeader({ title, close }: { title: string; close: () => void }) { return <div className="work-panel-heading"><h3>{title}</h3><button className="plain-icon" type="button" aria-label="Close editor" onClick={close}><X size={18}/></button></div>; }
function EditorButtons({ noun, disabled }: { noun: string; disabled: boolean }) { return <div className="button-row"><button type="submit" value="draft" className="button button-outline" disabled={disabled}>Save as draft</button><button type="submit" value="publish" className="button button-gold" disabled={disabled}><Check size={17}/> Publish {noun}</button></div>; }
export function HomepagePhotoEditor({ initial, alt, onSave, busy }: { initial: string; alt: string; onSave: (values: { photoId: string | null; alt: string }) => void; busy: boolean }) {
  const [photo, setPhoto] = useState<string | null>(initial || null), [uploading, setUploading] = useState(false);
  return <form method="post" className="form-stack home-photo-editor" onSubmit={(e) => { e.preventDefault(); onSave({ photoId: photo, alt: photo ? field(new FormData(e.currentTarget), "alt") : "" }); }}><PhotoPicker label="Homepage hero photo" photo={photo} setPhoto={setPhoto} onBusy={setUploading}/>{photo && <label>Image description<input name="alt" maxLength={140} defaultValue={alt} required/></label>}<p className="form-note">Remove the photo and save to restore the Nairobi skyline.</p><button type="submit" className="button button-gold align-start" disabled={busy || uploading}><Check size={16}/> Save homepage photo</button></form>;
}
