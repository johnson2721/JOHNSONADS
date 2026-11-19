// Run against a disposable local database server after npm run build.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import pg from "pg";
import { TOTP, Secret } from "otpauth";

const serverUrl = process.env.JDE_TEST_DATABASE_SERVER;
if (!serverUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(serverUrl).hostname)) throw new Error("Use JDE_TEST_DATABASE_SERVER pointing at a local PostgreSQL maintenance database.");
const dbName = `jde_smoke_${randomBytes(5).toString("hex")}`;
const database = new URL(serverUrl); database.pathname = `/${dbName}`;
const pool = new pg.Pool({ connectionString: serverUrl });
const temp = await mkdtemp(path.join(os.tmpdir(), "jde-smoke-"));
const canonical = "https://jde-smoke.example.test";
const userEmail = "seller@example.test";
const adminEmail = "ops@example.test";
const boxes = [];
const connections = new Set();
const smtp = net.createServer((socket) => {
  connections.add(socket); socket.once("close", () => connections.delete(socket)); socket.setEncoding("utf8"); socket.write("220 localhost test\r\n");
  let buffer = "", content = null;
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const next = buffer.indexOf("\n"); const line = buffer.slice(0, next).replace(/\r$/, ""); buffer = buffer.slice(next + 1);
      if (content !== null) {
        if (line === ".") { boxes.push(content.join("\n").replace(/=\n/g, "").replace(/=([\dA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))); content = null; socket.write("250 received\r\n"); }
        else content.push(line.startsWith("..") ? line.slice(1) : line);
      } else if (/^DATA$/i.test(line)) { content = []; socket.write("354 data follows\r\n"); }
      else if (/^QUIT$/i.test(line)) { socket.end("221 bye\r\n"); }
      else socket.write("250 ok\r\n");
    }
  });
});
const stub = `
const original = globalThis.fetch;
const { readFileSync } = require("node:fs");
let orderUnit, state = 'APPROVED', reads = 0;
const stks = new Map();
globalThis.fetch = async function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const p = url.pathname;
  if (url.hostname === 'backend.payhero.co.ke') {
    const expected = 'Basic ' + Buffer.from('simulated-payhero:simulated-credential').toString('base64');
    if (init?.headers?.Authorization !== expected) return Response.json({}, { status: 401 });
    const fixtures = JSON.parse(readFileSync(process.env.JDE_TEST_LIPWA_FIXTURE, 'utf-8'));
    if (p === '/api/v2/transaction-status') return Response.json(fixtures.status[url.searchParams.get('reference')] || { status: 'QUEUED' });
    if (p === '/api/v2/transactions') return Response.json({ data: { transactions: fixtures.ledger } });
    return Response.json({}, { status: 404 });
  }
  if (url.hostname.endsWith('payhero.co.ke') || url.hostname === 'lipwa.link' || url.hostname.endsWith('lipwa.app')) throw Error('Live Lipwa calls are disabled in smoke tests');
  if (url.hostname === 'sandbox.safaricom.co.ke') {
    if (p === '/oauth/v1/generate') return Response.json({ access_token: 'staging-daraja-token' });
    const body = JSON.parse(init.body);
    if (p === '/mpesa/stkpush/v1/processrequest') {
      if (String(body.Timestamp).length !== 14 || body.TransactionDesc.length > 13 || body.AccountReference.length > 12) return Response.json({ ResponseCode: '1' });
      const code = stks.size + 1;
      const pair = { CheckoutRequestID: 'SMOKE_STK_' + code, MerchantRequestID: 'SMOKE_MERCHANT_' + code };
      stks.set(pair.CheckoutRequestID, { ...pair, ResultCode: String(body.PhoneNumber).endsWith('1') ? '1032' : '0' });
      return Response.json({ ...pair, ResponseCode: '0' });
    }
    if (p === '/mpesa/stkpushquery/v1/query') return Response.json({ ...stks.get(body.CheckoutRequestID), ResponseCode: '0' });
    return Response.json({ ResponseCode: '1' }, { status: 404 });
  }
  if ((url.hostname.includes('paypal.com') || url.hostname.includes('safaricom.co.ke') || url.hostname.includes('binanceapi.com')) && url.hostname !== 'api-m.sandbox.paypal.com') throw Error('Provider call blocked by the staging smoke harness');
  if (url.hostname !== 'api-m.sandbox.paypal.com') return original(input, init);
  const method = init?.method || 'GET';
  if (p === '/v1/oauth2/token') return Response.json({ access_token: 'smoke-provider-stub' });
  if (p === '/v2/checkout/orders' && method === 'POST') {
    orderUnit = JSON.parse(init.body).purchase_units[0];
    return Response.json({ id: 'TESTPAYPALORDER', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=TESTPAYPALORDER' }] });
  }
  if (p === '/v2/checkout/orders/TESTPAYPALORDER') {
    const unit = { ...orderUnit, payee: { merchant_id: 'TESTMERCHANT' } };
    if (reads++ === 0) unit.amount = { currency_code: 'USD', value: '0.01' };
    if (state === 'COMPLETED') unit.payments = { captures: [{ id: 'TESTCAPTURE', status: 'COMPLETED', amount: orderUnit.amount }] };
    return Response.json({ id: 'TESTPAYPALORDER', status: state, purchase_units: [unit] });
  }
  if (p === '/v2/checkout/orders/TESTPAYPALORDER/capture') { state = 'COMPLETED'; return Response.json({ status: state }); }
  if (p === '/v2/payments/captures/TESTCAPTURE/refund') return Response.json({ id: 'TESTREFUND', status: 'COMPLETED', amount: orderUnit.amount });
  return Response.json({ name: 'NOT_FOUND_IN_SMOKE' }, { status: 404 });
};`;
function run(executable, args, env) {
  const result = spawnSync(executable, args, { env, encoding: "utf8", timeout: 45_000 });
  if (result.status !== 0) throw new Error(`Setup process failed: ${path.basename(executable)}\n${result.stderr}`);
  return result.stdout;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(find, label) {
  for (let i = 0; i < 80; i++) { const value = await find(); if (value) return value; await delay(125); }
  throw new Error(`Timed out: ${label}`);
}
async function emailLink(mode, who) {
  return retry(() => boxes.find((message) => message.includes(`To: ${who}`) && message.includes(`/account/${mode}#token=`))?.match(new RegExp(`/account/${mode}#token=([\\w-]{43})`))?.[1], `receiving ${mode} email`);
}
let child, logs = "", created = false, smtpOpen = false;
try {
  await pool.query(`CREATE DATABASE ${dbName}`); created = true;
  smtp.listen(0, "127.0.0.1"); await once(smtp, "listening"); smtpOpen = true;
  const reservation = net.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const lipwaFixture = path.join(temp, "lipwa.json");
  await writeFile(lipwaFixture, JSON.stringify({ status: {}, ledger: [] }));
  const env = { ...process.env, JDE_TEST_LIPWA_FIXTURE: lipwaFixture, LIPWA_ENABLED: "1", LIPWA_ORDER_LIMIT_KES: "250000", LIPWA_PAYHERO_API_USERNAME: "simulated-payhero", LIPWA_PAYHERO_API_PASSWORD: "simulated-credential", DATABASE_URL: database.toString(), APP_URL: canonical, ADMIN_LOGIN_EMAIL: adminEmail, ADMIN_NOTIFICATION_EMAIL: adminEmail, ADMIN_PASSWORD: "Disposable-admin-smoke-only-2026", JDE_VAULT_KEY: randomBytes(32).toString("hex"), JDE_SEED_EXAMPLES: "1", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.address().port), SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "smoke@example.test", SMTP_ALLOW_INSECURE: "1", MPESA_ENV: "sandbox", MPESA_CONSUMER_KEY: "simulated-key", MPESA_CONSUMER_SECRET: "simulated-secret", MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "simulated-passkey", MPESA_CALLBACK_SECRET: randomBytes(32).toString("hex"), BINANCE_PAY_ENABLED: "0", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "simulated-id", PAYPAL_CLIENT_SECRET: "simulated-secret", PAYPAL_MERCHANT_ID: "TESTMERCHANT", PAYPAL_KES_PER_USD: "125", S3_BUCKET: "", REQUIRE_CLOUD_STORAGE: "0" };
  run(path.resolve("node_modules/.bin/drizzle-kit"), ["push"], env);
  const provision = run(path.resolve("node_modules/.bin/tsx"), ["scripts/provision-admin.ts"], env);
  const secret = provision.match(/TOTP setup key: ([A-Z\d]+)/)?.[1]; assert.ok(secret);
  const previewEmail = "first-admin@example.test", previewPassword = "Temporary-smoke-2026", rotatedPassword = "New-secure-admin-password-2026";
  run(path.resolve("node_modules/.bin/tsx"), ["scripts/provision-admin.ts", "--browser-setup"], { ...env, ADMIN_LOGIN_EMAIL: previewEmail, ADMIN_PASSWORD: previewPassword });
  await writeFile(path.join(temp, "provider-stub.cjs"), stub, { mode: 0o600 });
  child = spawn(process.execPath, ["-r", path.join(temp, "provider-stub.cjs"), "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  const log = (chunk) => { logs = (logs + chunk).slice(-4500); };
  child.stdout.on("data", log); child.stderr.on("data", log);
  await retry(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, "launching staging server");
  const request = async (endpoint, { method = "GET", data, cookie, expected = 200, origin = canonical, text = false } = {}) => {
    const binary = Buffer.isBuffer(data);
    const response = await fetch(base + endpoint, { method, headers: { ...(method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { "Content-Type": binary ? "image/jpeg" : "application/json" } : {}) }, body: binary ? data : data !== undefined ? JSON.stringify(data) : undefined, redirect: "manual" });
    const body = text ? await response.text() : (response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined);
    assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(body)}`);
    return { body, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const userPassword = "Test-Password-Long-Only";
  const login = (email, password, code, expected = 200) => request("/api/auth/login", { method: "POST", data: { email, password, ...(code ? { code } : {}) }, expected });
  assert.equal((await request("/api/listings?q=MacBook")).body.total, 1);
  await request("/api/admin", { expected: 401 });
  await request("/api/enquiries", { method: "POST", origin: "https://untrusted.example.test", data: {}, expected: 403 });
  const registered = await request("/api/auth/register", { method: "POST", data: { name: "Staging Seller", email: userEmail, phone: "0712345678", country: "Kenya", businessName: "Smoke Studio", category: "Technology", seller: true, password: userPassword } });
  const cookie = registered.cookie; assert.ok(cookie); assert.equal(registered.body.user.verified, false);
  await request("/api/admin", { cookie, expected: 403 });
  await request("/api/auth/verify", { method: "POST", data: { token: await emailLink("verify", userEmail) } });
  assert.equal((await request("/api/me", { cookie })).body.user.verified, true);
  const photo = (await request("/api/media", { method: "POST", cookie, data: await readFile("public/images/headphones.jpg"), expected: 201 })).body;
  await request(photo.url, { expected: 404 }); await request(photo.url, { cookie });
  const listing = { title: "Staging headphones", description: "A valid seller listing for the isolated smoke test.", category: "Electronics", kind: "products", location: "Nairobi", price: 3500, photoIds: [photo.id], submit: false };
  const { body: draft } = await request("/api/listings", { method: "POST", cookie, data: listing, expected: 201 });
  assert.equal(draft.status, "draft");
  await request(`/api/listings/${draft.id}`, { method: "PATCH", cookie, data: { ...listing, submit: true } });
  await request(`/api/listings/${draft.slug}`, { expected: 404 });
  assert.equal((await login(adminEmail, env.ADMIN_PASSWORD)).body.mfaRequired, true);
  const totp = new TOTP({ issuer: "Johnson Digital Empire", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  const code = totp.generate();
  const { cookie: admin } = await login(adminEmail, env.ADMIN_PASSWORD, code); assert.ok(admin);
  await login(adminEmail, env.ADMIN_PASSWORD, code, 401);
  const attemptSetup = (password) => request("/api/auth/admin-login", { method: "POST", data: { email: previewEmail, password } });
  await request("/api/auth/admin-login", { method: "POST", data: { email: userEmail, password: userPassword }, expected: 401 });
  const { body: setup, cookie: setupCookie } = await attemptSetup(previewPassword);
  assert.ok(setup.setupRequired && setup.setupKey && setupCookie);
  await request("/api/admin/categories/products", { cookie: setupCookie, expected: 401 });
  const enrollCode = new TOTP({ issuer: "Johnson Digital Empire", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(setup.setupKey) }).generate();
  await request("/api/auth/admin-activate", { method: "POST", cookie: setupCookie, data: { password: rotatedPassword, code: "000000" === enrollCode ? "000001" : "000000" }, expected: 401 });
  const activated = await request("/api/auth/admin-activate", { method: "POST", cookie: setupCookie, data: { password: rotatedPassword, code: enrollCode } });
  await request("/api/admin/categories/products", { cookie: activated.cookie });
  await request("/api/auth/admin-activate", { method: "POST", cookie: setupCookie, data: { password: rotatedPassword, code: enrollCode }, expected: 401 });
  await login(previewEmail, previewPassword, undefined, 401);
  assert.equal((await attemptSetup(rotatedPassword)).body.mfaRequired, true);
  await request("/api/admin/categories/property", { cookie, expected: 403 });
  const editor = "/api/admin/categories/property";
  const galleryImage = await readFile("public/images/apartment.jpg");
  const photoFor = async () => (await request("/api/media", { method: "POST", cookie: admin, data: galleryImage, expected: 201 })).body;
  const cover = await photoFor(), storyPhoto = await photoFor();
  await request(cover.url, { expected: 404 });
  await request(editor, { method: "PATCH", cookie: admin, data: { heading: "Smoke property hub", summary: "Example category header", description: "This category has an editorial panel.", commentsEnabled: true, coverId: cover.id, coverAlt: "Property cover" } });
  await request(cover.url);
  const update = { title: "Preview update intended for smoke only", body: "This post and image should not display until published.", photoId: storyPhoto.id, photoAlt: "Updated property picture", status: "draft" };
  const story = (await request(`${editor}/updates`, { method: "POST", cookie: admin, data: update, expected: 201 })).body;
  const categoryPage = () => request("/marketplace?category=property", { text: true }).then((value) => value.body);
  assert.match(await categoryPage(), /Smoke property hub/);
  assert.doesNotMatch(await categoryPage(), /Preview update intended for smoke only/);
  await request(storyPhoto.url, { expected: 404 });
  await request(`${editor}/updates/${story.id}`, { method: "PATCH", cookie: admin, data: { ...update, status: "published" } });
  await request(storyPhoto.url);
  assert.match(await categoryPage(), /Preview update intended for smoke only/);
  const business = { name: "Staging Property Seller", category: "Property management", description: "A seller profile added privately by an administrator.", photoId: cover.id, location: "Nairobi", website: "https://example.com", status: "approved" };
  const editorSeller = (await request(`${editor}/sellers`, { method: "POST", cookie: admin, data: business, expected: 201 })).body;
  assert.match(await categoryPage(), /Staging Property Seller/);
  assert.match((await request(`/marketplace/${editorSeller.slug}`, { text: true })).body, /Seller website/);
  await request("/api/enquiries", { method: "POST", cookie, expected: 201, data: { kind: "enquiry", listingSlug: editorSeller.slug, subject: editorSeller.title, message: "Please tell me a little about this seller." } });
  const commentText = "A moderated property comment from smoke testing.";
  const comment = (await request("/api/categories/property/comments", { method: "POST", cookie, data: { body: commentText }, expected: 201 })).body;
  assert.doesNotMatch(await categoryPage(), /A moderated property comment/);
  await request(`${editor}/comments/${comment.id}`, { method: "PATCH", cookie: admin, data: { status: "visible" } });
  await request(`${editor}/comments`, { method: "POST", cookie: admin, data: { body: "Staff forum announcement." }, expected: 201 });
  assert.match(await categoryPage(), /A moderated property comment/);
  assert.match(await categoryPage(), /Staff forum announcement/);
  await request(`${editor}/comments/${comment.id}`, { method: "PATCH", cookie: admin, data: { status: "hidden" } });
  assert.doesNotMatch(await categoryPage(), /A moderated property comment/);
  const homePhoto = await photoFor();
  await request(homePhoto.url, { expected: 404 });
  await request("/api/admin/homepage-photo", { method: "PATCH", cookie: admin, data: { photoId: homePhoto.id, alt: "Published test homepage picture" } });
  assert.match((await request("/", { text: true })).body, /Published test homepage picture/);
  await request(homePhoto.url);
  await request(`${editor}/sellers/${editorSeller.id}`, { method: "DELETE", cookie: admin });
  await request(`${editor}/updates/${story.id}`, { method: "DELETE", cookie: admin });
  assert.doesNotMatch(await categoryPage(), /Staging Property Seller|Preview update intended for smoke only/);
  await request(storyPhoto.url, { expected: 404 });
  await request(`/api/admin/listings/${draft.id}`, { method: "PATCH", cookie: admin, data: { status: "approved" } });
  await request(`/api/listings/${draft.slug}`); await request(photo.url);
  const project = (await request("/api/enquiries", { method: "POST", cookie, expected: 201, data: { kind: "service", subject: "Website development", service: "website-development", message: "I want a catalogue website for my staging store." } })).body;
  await request(`/api/enquiries/${project.reference}/reply`, { method: "POST", cookie: admin, data: { response: "This includes a catalogue and contact form.", quote: 12000 } });
  assert.equal((await request("/api/dashboard", { cookie })).body.purchases.some((row) => row.kind === "website"), true);
  const order = (await request("/api/orders", { method: "POST", cookie, data: { kind: "plan", slug: "business" }, expected: 201 })).body;
  const options = (await request(`/api/checkout/${order.id}`, { cookie })).body.options;
  const paypal = options.find((item) => item.method === "paypal"); assert.equal(paypal.currency, "USD");
  const paid = (await request("/api/payments", { method: "POST", cookie, data: { orderId: order.id, ...paypal }, expected: 201 })).body;
  assert.equal(paid.status, "pending");
  await request(`/api/payments/${paid.id}/check`, { method: "POST", cookie, expected: 409 });
  assert.equal((await request("/api/dashboard", { cookie })).body.subs.length, 0);
  const captured = (await request(`/api/payments/${paid.id}/check`, { method: "POST", cookie })).body;
  assert.equal(captured.status, "confirmed");
  assert.equal((await request("/api/dashboard", { cookie })).body.subs.length, 1);
  await request(`/api/listings/${draft.id}/promote`, { method: "POST", cookie });
  assert.match((await request(`/api/receipts/${paid.id}`, { cookie, text: true })).body, /TESTCAPTURE/);
  const summary = (await request("/api/admin", { cookie: admin })).body;
  assert.equal(summary.stats.thisMonth.revenue, 2000); assert.equal(summary.stats.target, 500000);
  assert.match((await request("/api/admin/export", { cookie: admin, text: true })).body, /JDE-/);
  const refund = (await request(`/api/orders/${order.id}/refund`, { method: "POST", cookie, data: { reason: "Refund the completed staging payment." } })).body;
  await request(`/api/admin/refunds/${refund.reference}`, { method: "PATCH", cookie: admin, data: { decision: "approve", note: "Approved in staging." } });
  await request(`/api/admin/refunds/${refund.reference}`, { method: "PATCH", cookie: admin, data: { decision: "settle", note: "Verified with the simulated provider." } });
  assert.equal((await request("/api/admin", { cookie: admin })).body.stats.thisMonth.revenue, 0);
  const basic = (await request("/api/orders", { method: "POST", cookie, data: { kind: "plan", slug: "basic" }, expected: 201 })).body;
  const mpesa = (await request(`/api/checkout/${basic.id}`, { cookie })).body.options.find((item) => item.method === "mpesa");
  assert.deepEqual(mpesa, { method: "mpesa", currency: "KES", amount: "500" });
  const prompt = (phone) => request("/api/payments", { method: "POST", cookie, data: { orderId: basic.id, ...mpesa, phone }, expected: 201 }).then((r) => r.body);
  const callbackRoute = (id, key = env.MPESA_CALLBACK_SECRET) => `/api/webhooks/mpesa/${id}/${createHmac("sha256", key).update(id).digest("hex")}`;
  function stk(index, result, amount = 500) {
    return { Body: { stkCallback: { CheckoutRequestID: `SMOKE_STK_${index}`, MerchantRequestID: `SMOKE_MERCHANT_${index}`, ResultCode: result, ...(result === 0 ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "PhoneNumber", Value: 254712345678 }, { Name: "MpesaReceiptNumber", Value: "MPSMOKETXN" }] } } : {}) } } };
  }
  const cancelled = await prompt("0712345671");
  await request(callbackRoute(cancelled.id), { method: "POST", data: stk(1, 1032) });
  assert.equal((await request(`/api/checkout/${basic.id}`, { cookie })).body.payment.status, "failed");
  const stkPayment = await prompt("0712345678");
  assert.equal((await request(`/api/payments/${stkPayment.id}/check`, { method: "POST", cookie })).body.status, "pending");
  await request(callbackRoute(stkPayment.id, "not-the-configured-secret"), { method: "POST", data: stk(2, 0), expected: 404 });
  await request(callbackRoute(stkPayment.id), { method: "POST", data: stk(2, 0, 10), expected: 400 });
  await request(callbackRoute(stkPayment.id), { method: "POST", data: stk(2, 0) });
  await request(callbackRoute(stkPayment.id), { method: "POST", data: stk(2, 0) });
  assert.equal((await request(`/api/checkout/${basic.id}`, { cookie })).body.payment.status, "confirmed");
  assert.equal((await request("/api/admin", { cookie: admin })).body.stats.thisMonth.revenue, 500);
  const premium = (await request("/api/orders", { method: "POST", cookie, data: { kind: "plan", slug: "premium" }, expected: 201 })).body;
  const lipwaOption = (await request(`/api/checkout/${premium.id}`, { cookie })).body.options.find((item) => item.method === "lipwa");
  const hosted = (await request("/api/payments", { method: "POST", cookie, data: { orderId: premium.id, ...lipwaOption }, expected: 201 })).body;
  assert.equal(hosted.status, "pending");
  const gotoLipwa = new URL(hosted.checkoutUrl);
  assert.equal(gotoLipwa.origin + gotoLipwa.pathname, "https://lipwa.link/10283");
  assert.equal(gotoLipwa.searchParams.get("reference"), premium.reference); assert.equal(gotoLipwa.searchParams.get("amount"), "5000");
  assert.match((await request(`/checkout?order=${premium.id}&returned=1`, { text: true, cookie })).body, /Waiting for Lipwa confirmation/);
  const lipwaCheck = (reference, expected = 200) => request(`/api/payments/${hosted.id}/check`, { method: "POST", cookie, data: { reference }, expected }).then((result) => result.body);
  const resultWith = (code, fields = {}) => ({ status: "SUCCESS", transaction_reference: "4c84e58b-b6e6-4099-9a43-651fbdbaa667", provider_reference: code, provider: "m-pesa", external_reference: premium.reference, amount: 5000, currency: "KES", ...fields });
  const saveTestLipwa = (status, ledger = []) => writeFile(lipwaFixture, JSON.stringify({ status, ledger }));
  await lipwaCheck("123456", 400);
  assert.equal((await lipwaCheck("LIPWASMOKE")).status, "pending");
  await saveTestLipwa({ LIPWASMOKE: resultWith("LIPWASMOKE", { amount: 1 }) }); await lipwaCheck("LIPWASMOKE", 409);
  await saveTestLipwa({ LIPWASMOKE: resultWith("LIPWASMOKE", { external_reference: "JDE-WRONG" }) }); await lipwaCheck("LIPWASMOKE", 409);
  await saveTestLipwa({ MPSMOKETXN: resultWith("MPSMOKETXN") }); await lipwaCheck("MPSMOKETXN", 409);
  assert.equal((await request(`/api/checkout/${premium.id}`, { cookie })).body.payment.status, "pending");
  const summaryStatus = resultWith("LIPWASMOKE"); delete summaryStatus.amount; delete summaryStatus.external_reference;
  await saveTestLipwa({ LIPWASMOKE: summaryStatus }, [resultWith("LIPWASMOKE")]);
  assert.equal((await lipwaCheck("LIPWASMOKE")).status, "confirmed");
  assert.match((await request(`/api/receipts/${hosted.id}`, { cookie, text: true })).body, /LIPWASMOKE/);
  assert.equal((await request("/api/admin", { cookie: admin })).body.stats.thisMonth.revenue, 5500);
  await request("/api/auth/forgot", { method: "POST", data: { email: userEmail } });
  const reset = await emailLink("reset", userEmail);
  await request("/api/auth/reset", { method: "POST", data: { token: reset, password: "Staging-Reset-Password" } });
  await request("/api/dashboard", { cookie, expected: 401 });
  await login(userEmail, "Staging-Reset-Password");
  await retry(() => boxes.some((mail) => mail.includes("To: ops@example.test") && mail.includes("New Customer Activity")), "administrator notification");
  console.log("Isolated smoke passed: SMTP and verification, role and MFA enforcement, listing upload/moderation, quotation, first-time admin enrollment, category publishing and comment moderation, mocked PayPal/M-Pesa/Lipwa verification, promotion, receipt and financial reporting, refund, password reset.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err); console.error(logs.replace(/#token=[\w-]+/g, "#token=[hidden]")); process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), delay(3000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
  if (smtpOpen) { for (const socket of connections) socket.destroy(); smtp.close(); }
  if (created) await pool.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await pool.end(); await rm(temp, { force: true, recursive: true });
}
