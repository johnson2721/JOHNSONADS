import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/db";
import { rateBuckets } from "@/db/schema";

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function sameSecret(supplied: string, configured?: string) {
  return Boolean(configured && configured.length >= 24 && timingSafeEqual(Buffer.from(sha(supplied)), Buffer.from(sha(configured))));
}

const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}.${key.toString("hex")}`;
}
export async function checkPassword(password: string, stored?: string) {
  const [salt, hash] = (stored ?? `${"0".repeat(32)}.${"0".repeat(128)}`).split(".");
  const key = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected) && Boolean(stored);
}
export function vaultReady() { return /^[\da-f]{64}$/i.test(process.env.JDE_VAULT_KEY ?? ""); }
function vaultKey() {
  if (!vaultReady()) throw new Error("JDE_VAULT_KEY must be 32 bytes encoded as hex");
  return Buffer.from(process.env.JDE_VAULT_KEY!, "hex");
}
export function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  return [iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".");
}
export function unseal(value: string) {
  const [iv, data, end, tag] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.update(end)]).toString("utf8");
}

export function canonicalOrigin() {
  if (!process.env.APP_URL) return null;
  try { const url = new URL(process.env.APP_URL); return ["https:", "http:"].includes(url.protocol) ? url.origin : null; } catch { return null; }
}
export function requireOrigin(req: Request) {
  const value = req.headers.get("origin");
  if (!value || req.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "Open this page directly to submit the form.");
  let origin: URL;
  try { origin = new URL(value); } catch { throw new AppError(403, "Unrecognized request origin."); }
  const canonical = canonicalOrigin();
  const request = new URL(req.url);
  const allowed = [req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), request.host];
  if ((canonical && origin.origin !== canonical) || (!canonical && (!allowed.includes(origin.host) || !["http:", "https:"].includes(origin.protocol)))) throw new AppError(403, "Unrecognized request origin.");
  return origin.origin;
}
export function identity(req: Request) {
  const key = process.env.TRUST_PROXY_IP_HEADER;
  return key && req.headers.get(key) ? req.headers.get(key)!.split(",")[0].trim().slice(0, 100) : "unattributed";
}
export async function hitRate(key: string, limit: number, seconds: number) {
  const [row] = await db.insert(rateBuckets).values({ key: sha(key), count: 1, expiresAt: new Date(Date.now() + seconds * 1000) }).onConflictDoUpdate({ target: rateBuckets.key, set: {
    count: sql`case when ${rateBuckets.expiresAt} < now() then 1 else ${rateBuckets.count} + 1 end`,
    expiresAt: sql`case when ${rateBuckets.expiresAt} < now() then now() + (${seconds} * interval '1 second') else ${rateBuckets.expiresAt} end`,
  } }).returning({ count: rateBuckets.count });
  return row.count <= limit;
}
export async function limit(key: string, max: number, seconds: number) {
  if (!await hitRate(key, max, seconds)) throw new AppError(429, "Too many requests. Please wait a few minutes and try again.");
}

export async function readText(req: Request, max = 48_000) {
  if (Number(req.headers.get("content-length")) > max) throw new AppError(413, "This submission is too large.");
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError(413, "This submission is too large."); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readJson(req: Request) {
  const raw = await readText(req);
  try { return JSON.parse(raw) as unknown; } catch { throw new AppError(400, "Please submit valid form data."); }
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function handleError(error: unknown) {
  if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Check the form and try again." }, 400);
  if (error instanceof AppError) return json({ error: error.message }, error.status);
  console.error("Marketplace request failed", error instanceof Error ? error.name : "Unknown error", typeof error === "object" && error && "cause" in error && typeof error.cause === "object" && error.cause && "code" in error.cause ? error.cause.code : "");
  return json({ error: "Something went wrong. Please try again soon." }, 500);
}
export function emailStatus(reported: unknown) { return typeof reported === "string" && /^[A-Z0-9_-]{1,100}$/i.test(reported); }
