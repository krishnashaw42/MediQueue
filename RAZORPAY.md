# Razorpay Standard Checkout release

This folder preserves the deployed account-based MediQueue app and completes its existing booking payment flow. No database schema changes are required.

Server environment variables:

- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: shared merchant account fallback for all hospitals.
- `RAZORPAY_WEBHOOK_SECRET`: optional shared webhook secret. Configure the matching hospital webhook URL in Razorpay Dashboard for background capture reconciliation.
- Existing `PAYMENT_ENCRYPTION_KEY`, database and Supabase variables remain unchanged.

Saved hospital credentials take priority over the shared environment account. Credentials for older orders are resolved by their original Key ID. The secret never appears in checkout options; the server returns only the public Key ID, so no public environment prefix is required.

Create order: authenticated `POST /api/v2/order` with `serviceId`, `priority`, `smsConsent`, and a unique `requestKey`. The server derives the amount from the service price (minimum 100 paise). The official Razorpay SDK creates the provider order.

Verify: authenticated `POST /api/v2/verify` with the internal `orderId`, `gatewayOrderId` from `razorpay_order_id`, `paymentId` from `razorpay_payment_id`, and `signature` from `razorpay_signature`. The server verifies ownership, matches the stored gateway order, validates HMAC-SHA256 and checks the captured payment amount, currency and refund status before issuing one queue token. Mismatches and missing fields return 400. Provider authentication errors return 401; order API failures return 500.

Test with `npm test`, `npm run typecheck`, and `npm run build`. On the deployed website, sign in as a patient, choose a hospital and open service, and choose Pay. Use Razorpay test checkout options. A captured test payment should redirect to the token tracker. Dismissal and failed attempts should show messages without creating another concurrent checkout. Pending payments can be checked in My tokens & payments.

Configure automatic capture in the Razorpay Dashboard. The supplied keys are test keys; no real payments are accepted through them. Live payments require matching live keys and capture configuration.

Shared environment credentials and saved hospital credentials are checked separately. A configured account has keys present; successful authentication requires a valid matching Key ID and Key Secret. Use Account centre's Test connection action or the read-only `scripts/check-razorpay-auth.ts` diagnostic before testing checkout.
