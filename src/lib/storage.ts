import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, listings, type User } from "@/db/schema";
import { currentUser } from "./auth";
import { isEditorialPhoto } from "./editorial";
import { mediaPath } from "./marketplace";
import { publicCondition } from "./public-data";
import { AppError, UUID } from "./security";

const cap = 5 * 1024 * 1024;
function cloud() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;
  return { bucket, client: new S3Client({ region: process.env.AWS_REGION || "eu-west-1", ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) }) };
}
export async function uploadPhoto(req: Request, user: User) {
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "Choose a photo to upload.");
  if (Number(req.headers.get("content-length")) > cap) throw new AppError(413, "Each photo must be smaller than 5 MB.");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    if ((size += part.value.byteLength) > cap) { await reader.cancel(); throw new AppError(413, "Each photo must be smaller than 5 MB."); }
    parts.push(part.value);
  }
  const data = Buffer.concat(parts);
  const jpeg = data.length > 12 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  const png = data.length > 12 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new AppError(415, "Upload a JPG, PNG or WebP image.");
  const mime = "image/webp";
  let normalized: Buffer;
  try {
    normalized = await sharp(data, { limitInputPixels: 24_000_000, failOn: "warning" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  } catch { throw new AppError(415, "This photo could not be processed. Use a valid JPG, PNG or WebP below 24 megapixels."); }
  if (normalized.length > cap) throw new AppError(413, "This photo is too large. Choose a smaller image.");
  const id = randomUUID(); const store = cloud();
  if (process.env.REQUIRE_CLOUD_STORAGE === "1" && !store) throw new AppError(503, "Image storage is being configured. Please try again later.");
  const objectKey = store ? `marketplace/${user.id}/${id}` : null;
  if (store && objectKey) await store.client.send(new PutObjectCommand({ Bucket: store.bucket, Key: objectKey, Body: normalized, ContentType: mime, CacheControl: "private, max-age=180" }));
  await db.insert(assets).values({ id, ownerId: user.id, mime, objectKey, bytes: store ? null : normalized });
  return { id, url: mediaPath(id) };
}
export async function readPhoto(id: string) {
  if (!UUID.test(id)) throw new AppError(404, "Photo not found.");
  const [item] = await db.select().from(assets).where(eq(assets.id, id));
  if (!item) throw new AppError(404, "Photo not found.");
  const [publicRow] = await db.select({ id: listings.id }).from(listings).where(and(publicCondition(), sql`${listings.images} @> ${JSON.stringify([mediaPath(id)])}::jsonb`)).limit(1);
  const publiclyAccessible = !!publicRow || await isEditorialPhoto(id);
  if (!publiclyAccessible) {
    const user = await currentUser();
    if (!user || (item.ownerId !== user.id && user.role !== "admin")) throw new AppError(404, "Photo not found.");
  }
  if (item.objectKey) {
    const store = cloud();
    if (!store) throw new AppError(404, "Photo not found.");
    const url = await getSignedUrl(store.client, new GetObjectCommand({ Bucket: store.bucket, Key: item.objectKey, ResponseContentType: item.mime }), { expiresIn: 180 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  if (!item.bytes) throw new AppError(404, "Photo not found.");
  return new Response(new Uint8Array(item.bytes), { headers: { "Content-Type": item.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": publiclyAccessible ? "public, max-age=120" : "private, no-store" } });
}
