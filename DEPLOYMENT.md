# MediQueue cloud deployment — prepared, not deployed

Target: https://pocketlyss.in
Host: Vercel Hobby (personal, non-commercial project/demo only)
Database project: mediqueue / cybfrvweythiyiswswvh (Supabase Free)

## Prepared
- Separate cloud copy; the original experiment is untouched.
- SQLite calls converted to asynchronous PostgreSQL calls.
- Transactions use a transaction-scoped advisory lock to preserve single-writer behavior across hosting instances.
- Patient/hospital sessions, payment encryption, queue tracking, QR codes, and insights retained.
- Next.js patched to 16.3.8. Dependency audit reported zero vulnerabilities.
- Database schema in scripts/schema.sql; tables have RLS enabled without public policies. The app accesses PostgreSQL from server code, not the public Data API.
- No existing patient records, merchant keys, local database, or secrets copied into this directory.

## Verified locally
- Production build succeeded.
- TypeScript passed.
- Embedded PostgreSQL integration test passed: registration, session handling, owner isolation, booking idempotency, payment amount validation, payment replay, queue progress, insights, separate patient/hospital API sessions, encrypted payment credentials, and role enforcement.
- Supabase network connectivity and multi-instance lock behavior have not yet been tested against the hosted database.
- Live payment and SMS delivery have not been tested in this deployment.

## Remaining setup
1. Restore browser permission for supabase.com. The browser tool reports a saved user setting blocking this domain.
2. Run scripts/schema.sql once using the Supabase SQL Editor.
3. Use the project Connect dialog to obtain its transaction-pooler connection string. Configure DATABASE_URL privately on Vercel, replacing the password placeholder with the database password (URL-encode reserved characters).
4. Set a stable 64-character hexadecimal PAYMENT_ENCRYPTION_KEY in Vercel's private environment settings. Keep a private backup; changing it makes saved merchant secrets unreadable.
5. Set APP_ORIGIN=https://pocketlyss.in. If a preview URL is used for validation, configure that deployment's origin accordingly.
6. If required by the TLS certificate chain, set DATABASE_CA_CERT to the project CA certificate from Supabase. Certificate verification must remain enabled.
7. Deploy this directory to Vercel on Node 24. Do not upload .env files or local data.
8. Add pocketlyss.in and www.pocketlyss.in in Vercel, then apply the exact DNS records Vercel supplies in BigRock. Preserve email DNS records.
9. Verify the live domain, both account roles, saved data, queue behavior, QR tracking, and payment webhooks.

The cloud database starts empty. Create hospital and patient accounts after deployment. Connect Razorpay test credentials in the hospital Account Centre. Real SMS requires separately configured provider credentials; provider charges are not included in free hosting.
