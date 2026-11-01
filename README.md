# MediQueue

Hospital queue booking and tracking with patient and hospital accounts, PostgreSQL/Supabase storage, and Razorpay Standard Checkout. Built with Next.js App Router, React, and TypeScript; deploys on Vercel with Node.js 24.

## Local setup

1. Install Node.js 24 and run `npm install`.
2. Copy `.env.example` to `.env` and configure the database, application origin, and payment credentials. Add the Supabase URL and publishable key if using the included Supabase session proxy.
3. For a new database only, apply `scripts/schema.sql`. Existing deployments do not need new tables for the Razorpay update.
4. Run `npm run dev` and open `http://127.0.0.1:3001`.

Use `APP_ORIGIN=http://127.0.0.1:3001` for local development. Create patient and hospital accounts through the app; configure service prices and open services before accepting bookings.

## Payments

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as server environment variables to use a shared Razorpay account for hospitals. Credentials saved by a hospital in Account centre take priority. The server returns only the public Key ID to checkout; secrets remain on the server.

Set `PAYMENT_ENCRYPTION_KEY` to a stable, cryptographically random 64-character hexadecimal key. Generate it once for a new installation:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the key privately in the hosting environment and keep a secure backup. Do not replace it after saving merchant credentials; those credentials require the same key to decrypt.

Before testing a payment, use Account centre → Test connection → Save settings. A configured shared account can still be rejected by Razorpay: HTTP 401 means its Key ID and matching Key Secret need correction. Saved hospital credentials and shared credentials may authenticate differently. Do not put secrets in frontend variables or commit `.env` files.

The booking flow creates an order using the server's service price, opens Razorpay Checkout, verifies the callback signature and checks captured payment details before issuing a queue token. See [RAZORPAY.md](RAZORPAY.md) for API details and test steps.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

Tests cover account ownership, queue behavior, payment signatures, amount tampering, capture status, payment replay, and encrypted credential persistence. They use isolated test databases and mocked provider responses.

Read-only diagnostics (with environment variables loaded) are available:

```sh
node --env-file=.env --import tsx scripts/check-payment-config.ts
node --env-file=.env --import tsx scripts/check-razorpay-auth.ts
```

The first checks server encryption configuration and counts existing credential records. The second checks each hospital's effective Razorpay credentials without logging secrets or payment records.

## Deployment

Configure server variables privately in Vercel, use Node.js 24, then run the standard Next.js build. Environment changes require a new deployment. Use the main project URL for testing; older preview deployments retain their previous environment configuration.

Use test-mode keys for simulated payments. Before accepting real payments, configure matching live-mode keys, capture, and webhooks in Razorpay Dashboard. SMS requires separately configured provider credentials.
