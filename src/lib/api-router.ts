import { z } from "zod";
import { found, route } from "@/lib/http";
import { activateAdmin } from "@/lib/admin-activation";
import { archiveSellerProfile, categoryWorkspace, deleteCategoryUpdate, moderateComment, postCategoryComment, saveCategory, saveCategoryUpdate, saveHomepagePhoto, saveSellerProfile } from "@/lib/editorial";
import { currentUser, clientUser, endSession, requireUser } from "@/lib/auth";
import { forgotPassword, login, register, resendVerification, updateProfile, useToken } from "@/lib/accounts";
import { archiveListing, completeOrder, favorite, myDashboard, placeOrder, promoteListing, recordView, replyInquiry, requestRefund, savedListings, writeInquiry, writeListing } from "@/lib/marketplace";
import { card, findListings, getListing } from "@/lib/public-data";
import { readPhoto, uploadPhoto } from "@/lib/storage";
import { adminDashboard, financialCsv } from "@/lib/financial";
import { addExpense, changePlan, closeInquiry, decideListing, jobs, retryNotification, suspendUser, updateContent } from "@/lib/admin";
import { beginPayment, cancelOrder, checkLipwaAdmin, checkPayment, checkoutData, manageRefund, receiptFile, receiveBinance, receiveMpesa, receivePayPal } from "@/lib/payments";
import { binanceWebhook, paypalWebhook, validMpesaProof } from "@/lib/providers";
import { AppError, identity, json, limit, readJson, readText, requireOrigin, sameSecret, UUID } from "@/lib/security";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, context: Context) {
  return route(async () => {
    const { path } = await context.params;
    const [base, id, third, fourth] = path;
    if (base === "media" && id && !third) return readPhoto(id);
    if (base === "listings" && !id) {
      const url = new URL(req.url);
      const slugs = url.searchParams.get("slugs")?.slice(0, 2700);
      if (slugs) {
        const rows = await Promise.all([...new Set(slugs.split(","))].slice(0, 24).map(getListing));
        return json({ items: rows.flatMap((row) => row ? [card(row.listing)] : []) });
      }
      const lookup = (key: string) => url.searchParams.get(key) ?? undefined;
      return json(await findListings({ q: lookup("q"), kind: lookup("category"), location: lookup("location"), min: lookup("min"), max: lookup("max"), sort: lookup("sort"), page: Math.trunc(Number(lookup("page"))) || 1 }));
    }
    if (base === "listings" && id && !third) { const item = await getListing(id); return item ? json({ item: card(item.listing) }) : found(); }
    if (base === "me" && !id) { const user = await currentUser(); return json({ user: user ? clientUser(user) : null }); }
    if (base === "saved" && !id) return json({ items: await savedListings(await requireUser()) });
    if (base === "dashboard" && !id) return json(await myDashboard(await requireUser()));
    if (base === "checkout" && id && !third) return json(await checkoutData(await requireUser(), id));
    if (base === "receipts" && id && !third) return receiptFile(await requireUser(), id);
    if (base === "admin") {
      const admin = await requireUser({ admin: true });
      if (id === "export" && !third) return financialCsv(admin);
      if (id === "categories" && third && !fourth) return json(await categoryWorkspace(third));
      if (!id) return json(await adminDashboard());
    }
    return found();
  });
}
export async function POST(req: Request, context: Context) {
  return route(async () => {
    const { path } = await context.params;
    const [base, id, action, fourth] = path;
    const ip = identity(req);
    if (base === "jobs" && !id) {
      if (!sameSecret(req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "", process.env.JOBS_TOKEN)) return found();
      return json(await jobs());
    }
    if (base === "webhooks") {
      if (id === "mpesa" && action && fourth && path.length === 4 && UUID.test(action) && validMpesaProof(action, fourth)) return json(await receiveMpesa(action, await readJson(req)));
      if (id === "paypal" && !action) {
        const body = await readJson(req);
        if (!await paypalWebhook(req, body)) throw new AppError(403, "Webhook verification failed.");
        return json(await receivePayPal(body));
      }
      if (id === "binance" && !action) {
        const raw = await readText(req);
        if (!binanceWebhook(req, raw)) throw new AppError(403, "Webhook verification failed.");
        let body: unknown;
        try { body = JSON.parse(raw); } catch { throw new AppError(400, "Invalid callback."); }
        await receiveBinance(body); return json({ returnCode: "SUCCESS", returnMessage: null });
      }
      return found();
    }
    requireOrigin(req);
    if (base === "auth" && !action) {
      if (id === "logout") return endSession(req);
      if (id === "resend") return json(await resendVerification(await requireUser()));
      await limit(`auth:${id}:${ip}`, id === "login" ? 80 : 30, 900);
      if (id === "register") return register(req, await readJson(req));
      if (id === "login" || id === "admin-login") return login(req, await readJson(req), id === "admin-login");
      if (id === "admin-activate") return activateAdmin(req, await readJson(req));
      if (id === "forgot") return json(await forgotPassword(await readJson(req)));
      if (id === "verify" || id === "reset") return json(await useToken(id, await readJson(req)));
      return found();
    }
    if (base === "enquiries" && !id) {
      const user = await currentUser();
      await limit(`inquiry:${user?.id ?? ip}`, user ? 12 : 20, 900);
      const body = await readJson(req);
      if (!user && typeof body === "object" && body && "email" in body && typeof body.email === "string") await limit(`inquiry-email:${body.email.trim().toLowerCase().slice(0, 180)}`, 6, 900);
      return json(await writeInquiry(user, body), 201);
    }
    if (base === "listings" && id && action === "view" && !fourth) {
      const user = await currentUser();
      await limit(`views:${user?.id ?? ip}`, user ? 70 : 180, 900);
      return json(await recordView(id, user?.id ?? ip));
    }
    const user = await requireUser({ admin: base === "admin" });
    await limit(`write:${user.id}`, 180, 900);
    if (base === "categories" && id && action === "comments" && !fourth) {
      if (!user.verified) throw new AppError(403, "Verify your email before posting a comment.");
      await limit(`category-comment:${user.id}`, 8, 900);
      return json(await postCategoryComment(user, id, await readJson(req)), 201);
    }
    if (base === "media" && !id) { await limit(`upload:${user.id}`, 40, 86400); return json(await uploadPhoto(req, user), 201); }
    if (base === "listings" && !id) return json(await writeListing(user, await readJson(req)), 201);
    if (base === "listings" && id && action === "promote" && !fourth) return json(await promoteListing(user, id));
    if (base === "saved" && id && !action) { const { save } = z.object({ save: z.boolean() }).parse(await readJson(req)); return json(await favorite(user, id, save)); }
    if (base === "enquiries" && id && action === "reply" && !fourth) return json(await replyInquiry(user, id, await readJson(req)));
    if (base === "orders" && !id) return json(await placeOrder(user, await readJson(req)), 201);
    if (base === "orders" && id && !fourth) {
      if (action === "refund") return json(await requestRefund(user, id, await readJson(req)));
      if (action === "complete") return json(await completeOrder(user, id));
      if (action === "cancel") return json(await cancelOrder(user, id));
    }
    if (base === "payments" && !id) {
      if (!user.verified) throw new AppError(403, "Verify your email before paying for an order.");
      await limit(`begin-payment:${user.id}`, 15, 900);
      return json(await beginPayment(user, await readJson(req)), 201);
    }
    if (base === "payments" && id && action === "check" && !fourth) {
      await limit(`check-payment:${user.id}`, 40, 900);
      return json(await checkPayment(user, id, req.headers.get("content-type")?.includes("application/json") ? await readJson(req) : undefined));
    }
    if (base === "admin" && id === "categories" && action && fourth && path.length === 4) {
      if (fourth === "updates") return json(await saveCategoryUpdate(user, action, await readJson(req)), 201);
      if (fourth === "sellers") return json(await saveSellerProfile(user, action, await readJson(req)), 201);
      if (fourth === "comments") return json(await postCategoryComment(user, action, await readJson(req), true), 201);
    }
    if (base === "admin" && !fourth) {
      if (id === "lipwa" && action) { await limit(`admin-lipwa:${user.id}`, 30, 900); return json(await checkLipwaAdmin(user, action)); }
      if (id === "expenses" && !action) return json(await addExpense(user, await readJson(req)), 201);
      if (id === "retry-email" && action) return json(await retryNotification(action));
      if (id === "close-enquiry" && action) return json(await closeInquiry(user, action));
    }
    return found();
  });
}
export async function PATCH(req: Request, context: Context) {
  return route(async () => {
    const { path } = await context.params;
    const [base, id, resource, fourth, fifth] = path;
    requireOrigin(req);
    const user = await requireUser({ admin: base === "admin" });
    await limit(`write:${user.id}`, 180, 900);
    const body = await readJson(req);
    if (base === "profile" && !id) return json(await updateProfile(user, body));
    if (base === "listings" && id && !resource) return json(await writeListing(user, body, id));
    if (base === "admin" && id === "categories" && resource && path.length <= 5) {
      if (!fourth) return json(await saveCategory(user, resource, body));
      if (fifth && fourth === "updates") return json(await saveCategoryUpdate(user, resource, body, fifth));
      if (fifth && fourth === "sellers") return json(await saveSellerProfile(user, resource, body, fifth));
      if (fifth && fourth === "comments") return json(await moderateComment(user, resource, fifth, body));
    }
    if (base === "admin" && !fourth) {
      if (id === "homepage-photo" && !resource) return json(await saveHomepagePhoto(user, body));
      if (id === "content" && !resource) return json(await updateContent(user, body));
      if (resource) {
        if (id === "listings") return json(await decideListing(user, resource, body));
        if (id === "accounts") return json(await suspendUser(user, resource, body));
        if (id === "packages") return json(await changePlan(user, resource, body));
        if (id === "refunds") return json(await manageRefund(user, resource, body));
      }
    }
    return found();
  });
}
export async function DELETE(req: Request, context: Context) {
  return route(async () => {
    const { path } = await context.params;
    const [base, id, third, fourth, fifth] = path;
    requireOrigin(req);
    const user = await requireUser({ admin: base === "admin" });
    await limit(`write:${user.id}`, 180, 900);
    if (base === "listings" && id && !third) return json(await archiveListing(user, id));
    if (base === "admin" && id === "categories" && third && fifth && path.length === 5) {
      if (fourth === "updates") return json(await deleteCategoryUpdate(user, third, fifth));
      if (fourth === "sellers") return json(await archiveSellerProfile(user, third, fifth));
    }
    return found();
  });
}
