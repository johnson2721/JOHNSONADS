# Johnson Digital Empire

Kenya-first marketplace and advertising platform. **Connecting Businesses. Creating Opportunities. Growing Wealth.**

This repository is the complete application: Next.js App Router and TypeScript/React for the site and REST API, Tailwind and authored CSS, and PostgreSQL via Drizzle. The database definition is in `src/db/schema.ts`. `src/lib/api-router.ts` exposes the REST handlers mounted at `/api/*`. No Python service is required in this runtime.

## Install and run

1. Use Node.js 22 or later, npm, and PostgreSQL with a new database (local example: `app_db`).
2. Run `npm ci`. Copy `.env.example` to `.env`, set `DATABASE_URL`, set `APP_URL` to the exact origin you will visit, and generate distinct vault and job secrets (`openssl rand -hex 32` for each). Use `JDE_SEED_EXAMPLES=1` to browse illustrative listings. They cannot be purchased and do not count toward revenue.
3. Run `npx drizzle-kit push` against a **fresh development database**, then `npm run dev`. Packages are inserted idempotently; their prices and features are subsequently managed in the admin dashboard.
4. Visit `/api/health` for DB liveness and `/api/listings` for a schema and catalogue smoke check. Visit `/account/register?intent=sell` to register a seller, `/dashboard` to manage an account, and `/admin` for private operations.
5. Verify changes with `npx next typegen`, `npm exec tsc -- --noEmit --pretty false`, and `npm run build`.

Without SMTP, registration and drafts still work, but verification, password recovery, publishing and paying need their respective integrations. Unconfigured payment methods are not advertised as available.

After building, run `JDE_TEST_DATABASE_SERVER=postgresql://postgres:postgres@127.0.0.1:5432/postgres node scripts/smoke.mjs` to test against a disposable **local** PostgreSQL database. It starts and stops its own local server, uses a local SMTP sink, simulates provider responses (including amount mismatches, M-Pesa cancellations and repeat callbacks), and drops only the isolated database it creates. It does not replace merchant sandbox testing.

## Administrator setup (TOTP required)

Use a trusted, interactive terminal with the production environment and database access. Configure `ADMIN_LOGIN_EMAIL` in the application (this can differ from `ADMIN_NOTIFICATION_EMAIL`). Do not send the password or setup key by email.

```bash
read -rsp 'Administrator password (16+ characters): ' ADMIN_PASSWORD; echo
ADMIN_PASSWORD="$ADMIN_PASSWORD" npx tsx scripts/provision-admin.ts
unset ADMIN_PASSWORD
```

Add the setup key to an authenticator app: time-based, SHA-1, six digits, 30 seconds. Keep it offline in a secure place. Log in at `/account/login`, then enter the current TOTP code. Admin sessions expire after eight hours. To recover or rotate a compromised admin credential, repeat with `scripts/provision-admin.ts --rotate`; this invalidates prior sessions. Public password reset never changes an administrator's credentials. There is no default password, and the public signup route cannot grant admin privileges.

### Access the private publishing portal

Go directly to `/admin` (the sign-in page is at `/admin/login` and is not linked for visitors). Accounts provisioned with the `--browser-setup` flag have a 72-hour window to complete first sign-in: enter the temporary password, add the displayed key to your authenticator, enter the six-digit code, and replace the temporary password with a new one of at least 16 characters. The temporary credential grants no session or access to protected routes. To reissue a temporary credential from a trusted terminal, use `scripts/provision-admin.ts --browser-setup --rotate` with `ADMIN_PASSWORD` supplied as a process secret. Use the same `JDE_VAULT_KEY` in the application and the provisioning command. Do not put a password in a public environment variable or commit it to the repository.

- **Category manager:** Select a category, then use **Page & cover**, **Updates**, **Seller profiles**, or **Comments**. Publishing changes the public category page at `/marketplace?category=<key>`. Draft posts and their images are private. Visitor comments require a verified account and remain private until approved; staff comments can be published directly, and published comments can be hidden.
- **Seller profiles:** Supply public business name, specialty, location, description, photo and an optional HTTPS website. Publishing adds a seller card to the relevant category and to the Business directory. This creates a showcase profile, not an account with login permissions. Marketplace support receives its enquiries. For registered sellers’ listings, use **Listing moderation**.
- **Website content:** Edit homepage and announcement text and replace the homepage hero photo. Removing the custom photo restores the default skyline.

## Email, retries, and scheduled tasks

Use verified transactional SMTP (`SMTP_HOST`, port, user, password, approved `SMTP_FROM`). 587 uses STARTTLS; 465 uses implicit TLS. Configure SPF, DKIM and DMARC on the sender domain. Use a local SMTP capture service and `SMTP_ALLOW_INSECURE=1` **only for controlled local testing**. The default administrator recipient is `johnsonkanyiri0@gmail.com`. Change `ADMIN_NOTIFICATION_EMAIL` to a controlled inbox for staging.

Registrations, submitted listings, enquiries, orders and payment outcomes are logged with an administrator email outbox entry in the same transaction. Contact notices link to the full enquiry in the private inbox; free-form bodies are not copied into administrator emails. Payment emails to administrators contain references and status, not payment credentials. Verification and reset links go only to the account address, and are single-use, time-limited, hashed in the authentication table and encrypted in the outbox until delivery. Administrator notification logs do not show these links.

For dependable retries and reconciliation, configure a scheduler to make a server-to-server `POST https://your-host/api/jobs` with `Authorization: Bearer <JOBS_TOKEN>` every 2–5 minutes. Set the HTTP timeout high enough for the batch (up to five minutes); run only one scheduled job at a time. The app also attempts delivery after requests without keeping the browser waiting. Mail is leased, retried with backoff, and logged as sent or failed. Ensure alerts on terminal failures, ageing pending payments, and an unavailable scheduler. Missing configuration never silently marks mail as delivered.

## Payment providers

Always use sandbox/test merchant credentials first. Set `APP_URL` to a public HTTPS staging origin for provider callbacks and return URLs. Orders use whole KES prices. USD and USDT charges are disclosed separately before checkout and recorded against the KES order value; set the exchange rates to your approved storefront rates. Each order has at most one active payment attempt. A browser redirect, an image, a shared reference, or an administrator screen cannot mark a checkout paid.

### M-Pesa Daraja

1. Create a sandbox app at [Safaricom Daraja](https://developer.safaricom.co.ke/) and enable M-Pesa Express and Express Query.
2. Configure `MPESA_ENV=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` and an independent random `MPESA_CALLBACK_SECRET`. Set the appropriate transaction type and `MPESA_PARTY_B` for your approved PayBill or Till. Set `MPESA_ORDER_LIMIT_KES` for your merchant agreement.
3. Verify a test buyer’s email, create an order, choose M-Pesa, and use the phone number supplied by Daraja for simulations. The backend sends STK Push and sets its own per-payment signed public callback URL. You do not ask for or collect the M-Pesa PIN. Redact callback path tokens from proxy request logs.
4. The callback must match the stored checkout ID, merchant request ID, amount and phone. The app independently checks Express Query with Daraja credentials. Only the combined success triggers the receipt and package activation. The schedule retries provider checks for stored callbacks. Cancellation remains a failed attempt only after a definitive provider result. If a provider call returns ambiguously or a callback never arrives, reconcile the pending payment with Safaricom; do not issue another prompt or manually credit an unverified payment.
5. After Safaricom production approval and end-to-end sandbox tests, set `MPESA_ENV=production` and use approved live credentials. Re-run tests for success, failure, mismatched totals, and duplicate delivery before opening checkout to customers.

### Lipwa hosted checkout (Pay Hero)

- The default hosted link is `https://lipwa.link/10283`. The app passes the exact KES total and a unique JDE order reference to the hosted page. Customers can return to the order and submit their M-Pesa code or Lipwa payment reference. Browser redirects, customer-entered codes, and screenshots alone never confirm payment.
- Set `LIPWA_PAYHERO_API_USERNAME` and `LIPWA_PAYHERO_API_PASSWORD` to the [Pay Hero](https://docs.payhero.co.ke/pay-hero-developer-apis/authorization) merchant API credentials for the **same account that owns the hosted link**. The app uses the authenticated status endpoint and, when necessary, recent transaction records to confirm a successful payment with the matching order reference and KES amount. The checking form and admin **Payments** tab can both trigger reconciliation. A pending order is not fulfilled, included in financial reports, or issued a receipt. Verify the exact status/ledger payload on your merchant account before accepting live customer funds.
- Without merchant API credentials, the hosted link can be opened and the submitted reference is saved, but no Lipwa payment is confirmed. The checkout warns customers not to send live funds before speaking to support. Set `LIPWA_ENABLED=0` if you want the method hidden until verification is ready. Make sure the hosted link collects in KES and preserves the order reference.

### PayPal

Create a REST app at [PayPal Developer](https://developer.paypal.com/docs/checkout/standard/), set `PAYPAL_ENV=sandbox`, the client ID/secret, the merchant ID, and `PAYPAL_KES_PER_USD`. Register `/api/webhooks/paypal` for `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING` and `PAYMENT.CAPTURE.DENIED`, then set `PAYPAL_WEBHOOK_ID`. Webhooks are verified via PayPal’s verification API; the app re-reads the order and completed capture before settling. Live mode requires a merchant ID and a separately configured live webhook. PayPal refunds are requested and verified through the Payments v2 API.

### Binance Pay

Disabled by default. Use an approved [Binance Pay merchant](https://developers.binance.com/docs/binance-pay/introduction) account **only where your business and customers are legally eligible**. Configure the key/secret, merchant ID, `BINANCE_KES_PER_USDT`, and an explicit comma-delimited list in `BINANCE_PAY_COUNTRIES` matching registered account country names. The country filter alone is not regulatory verification. Set `BINANCE_PAY_ENABLED=1` only after completing merchant, jurisdiction, and compliance checks. Configure `/api/webhooks/binance` with the active Binance webhook certificate serial and public PEM key. Rotate the key on provider rotation. The signed notification triggers an authenticated order query; a `PAID` result must match the merchant, trade reference, currency and amount. Authenticated status checks and the scheduler also reconcile pending orders.

### Fulfilment and refunds

A verified package grants promotion slots for approved listings in the seller dashboard. Package renewals are explicit purchases, not recurring charges; early renewals extend the remaining term. Financial reports include product marketplace commissions rather than the seller’s share as platform revenue. Expenses are recorded by the administrator. The KSh 500,000 monthly target is distinct from realized results. Gateway fees and operational costs which affect the profit estimate should be entered as real expenses.

Fulfilment is tracked in the dashboard; inventory, carrier labels, seller payout settlement, invoicing/tax rules, and a regulated split-payment flow are **not** automated. Before processing third-party product payments commercially, confirm that your merchant contract and settlement model allow them. For non-PayPal refunds, authorised operators execute and verify the reversal in the provider’s merchant portal and record the resulting reference. A customer’s refund request never triggers payment automatically. Test reconciliation of refunds/disputes against the provider ledger before launch.

## Storage, deployment, and backups

- Use an S3 or S3-compatible **private** bucket with encryption, lifecycle rules and least-privilege credentials limited to the marketplace prefix. Set `S3_BUCKET`, `AWS_REGION`, optional `S3_ENDPOINT`, and `REQUIRE_CLOUD_STORAGE=1` for launch. Image access is checked by the application; cloud objects use short-lived read URLs. Without cloud configuration, a local test installation can store small images in PostgreSQL.
- Deploy a Node server/container: install dependencies, apply reviewed schema changes before receiving traffic, then build and start with the platform process manager. `npx drizzle-kit push` is intended for a new development database; use version-controlled, reviewed `drizzle-kit generate` / `migrate` migrations and backups for production changes. Use an HTTPS reverse proxy, inject secrets from a secret store, configure a trusted client-IP header, and rate-limit webhook ingress at the edge. Do not cache private API traffic. Use `JDE_SEED_EXAMPLES=0` in commercial deployments. Consider a connection pooler for multiple replicas.
- For database backups, use managed PostgreSQL point-in-time restore and/or schedule `bash scripts/backup.sh` under a restricted account with `pg_dump` and `age` available. Supply `DATABASE_URL`, `BACKUP_AGE_RECIPIENT` (a public encryption key), and `BACKUP_DIR` in the backup worker environment. Keep encrypted backups off-site; use key rotation, retention rules, and scheduled restore drills. Restore the decrypted custom dump with `pg_restore --exit-on-error --no-owner --no-acl --dbname <new database>` on an isolated instance. Back up the private image bucket and preserve the vault key separately.
- Before a pilot: set authenticated SMTP and recipient, enrol MFA and confirm role isolation, run all provider sandboxes, restore a backup, review listing and dispute policies, decide retention and Kenyan Data Protection Act obligations, and review the merchant and payout model. Pilot in staging before enabling live forms of payment. The default policy page is a starting point, not legal advice.

## Main endpoints

- `GET /api/listings` supports `q`, `category`, `location`, `min`, `max`, `sort`, `page`; `GET /api/listings/:slug` reads a public listing.
- `POST /api/auth/{register,login,logout,forgot,reset,verify,resend}` and `PATCH /api/profile` handle the account lifecycle.
- `GET /api/dashboard`, `POST /api/media`, `POST /api/listings`, `PATCH|DELETE /api/listings/:id` serve the seller workspace. `POST /api/enquiries` accepts support and service forms.
- `POST /api/orders`, `POST /api/payments`, `POST /api/payments/:id/check`, `GET /api/receipts/:id` handle checkout.
- `GET /api/admin` and `GET /api/admin/export` require a valid administrator MFA session. Mutation routes are protected by role/ownership, rate limits, and same-origin checks.
