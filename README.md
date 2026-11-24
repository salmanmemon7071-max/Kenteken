# VINtrue website and admin panel

This project includes a customer website, an email/password-protected admin panel, and a small Node.js server with persistent storage. It uses only Node.js built-ins.

## Start locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_EMAIL` to your email and replace `ADMIN_PASSWORD` with a unique password of at least 14 characters.
4. Keep `.env` private and do not commit it.
5. Run `npm start` (or `node server.js`).
6. Open `http://127.0.0.1:4173` for the website and `http://127.0.0.1:4173/admin` for the admin sign-in.

There is no public sign-up or default admin account. Do not commit `.env` or share it. The server refuses to start if the admin email or password is missing or invalid.

## Put the website on a domain (Render example)

The local address `127.0.0.1` works only on your computer. A domain needs a public web host running this Node.js app.

1. Create a private GitHub repository and upload the project files. Keep `.env`, `data`, `uploads`, and `reports` out of Git; they are already excluded by `.gitignore`.
2. In Render, create a **Web Service** connected to that repository. Use `npm install` as the build command and `npm start` as the start command.
3. Attach a persistent disk mounted at `/var/data`. This project stores orders, uploaded logos, reports, and Admin-managed gateway settings on disk; without persistent storage, those can be lost after a deploy or restart.
4. Add these environment variables in the Render service settings:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `APP_ENV_FILE=/var/data/.env`
   - `DATA_DIR=/var/data/data`
   - `UPLOAD_DIR=/var/data/uploads`
   - `REPORT_DIR=/var/data/reports`
   - `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters
   - `APP_BASE_URL=https://your-domain.com` (replace with your domain)
   - `RESEND_API_KEY` and `EMAIL_FROM` after verifying your sender domain with Resend
5. Deploy and test the temporary `onrender.com` address. In Admin → Payment Gateway, confirm the public website URL and configure the provider keys.
6. Buy a domain from a registrar if you do not already own one. In Render → your service → **Settings → Custom Domains**, add the domain. Render will show the DNS records to enter at your registrar; copy those records exactly, then return to Render and verify the domain.
7. Once DNS has propagated and HTTPS is active, set `APP_BASE_URL` to the final HTTPS address, redeploy/restart, and test a Stripe sandbox order before switching to Live mode.

Use the host's persistent-disk option: Render's default service filesystem is temporary, and persistent disks require an eligible paid web-service plan. The app uses one Node.js process and local JSON storage; do not run multiple service instances against these files.

## Admin features

- Search orders by date range (UTC), customer name, phone, VIN, or license plate; assign a team agent, update status, inspect the order evidence, and export filtered orders to Excel-compatible CSV.
- Change the admin password from the signed-in dashboard; the current password is required and new passwords must be at least 14 characters.
- Maintain the team agent list; upload PDF reports and email secure portal links. Customers must verify the order email using a single-use code before the PDF can be downloaded. Verification and download events are added to the evidence timeline.
- Edit, add, remove, and reorder packages. Saved names, prices, and contents are loaded by the public site from `/api/public/settings`.
- Edit, add, and remove customer FAQs in Admin → Customer FAQs; the home page refreshes from the saved settings.
- Edit the About Us, Terms & Conditions, Privacy Policy, and Refund Policy copy in Admin → Policy Pages.
- Change the shared header/footer logo and customize footer headings, contact details, navigation links, payment labels, and copyright.
- Review order activity, package and consent snapshots, processor evidence fields, report hashes, delivery records, and completed report-download events in the Dispute Evidence view. Audit events continue to be recorded by the server.

Site settings, orders, agent assignments, order timelines, and access evidence persist as ordinary JSON data under `data/store.json`. Uploaded logo files are saved under `uploads/`; customer report PDFs are stored privately under `reports/` and served only after email verification through the report portal. The portal URL identifies the order but does not grant PDF access by itself. Back up all three folders and restrict access to them. Order records include the request IP address and derived browser, device, and platform categories; raw browser user-agent strings are not retained. Completed report-download events record server time, response status, bytes sent, and whether the request looks automated. A finished download response does not prove a person opened or read the PDF. Payment authentication fields require a connected processor and are otherwise blank. New order references use a configurable prefix, customer initials, order date, and a daily sequence.

## Security and payment status

Admin API routes require an HttpOnly, SameSite=Strict session cookie and a CSRF token. The report portal sends one-time codes through Resend; codes expire in 10 minutes, are single-use, have a five-attempt limit, and unlock a 30-minute HttpOnly session. Per-IP, per-email, and per-order code request limits apply. These portal challenges and sessions are held in memory and are invalidated by a server restart. Failed sign-ins are rate-limited; sessions expire after eight hours and are held in memory, so a server restart signs admins out. The browser restores an active session from its HttpOnly cookie after a page refresh. The server listens on localhost by default. For public deployment, use an HTTPS reverse proxy, set `HOST` appropriately, set `NODE_ENV=production`, protect the server and backups, and keep the admin password private. Set `TRUST_PROXY=true` only when a trusted reverse proxy removes client-supplied forwarding headers and sets its own `X-Forwarded-For`; otherwise the server records the direct connection address. This minimal server has no external database, multi-admin roles, or cloud backup.

Report download logs record that a valid report link requested a PDF response; they cannot establish who physically used the device or prove that a human read the file. Disclose IP/browser collection in the Privacy Policy. Payment processors must provide their own transaction, AVS/CVV, and 3-D Secure evidence after integration; server-side order logs alone do not prove cardholder identity.

Customer payment uses provider-hosted checkout pages. The site does not accept or store card details. Stripe Checkout requests automatic 3-D Secure when the issuer or card requires it; PayPal and Authorize.Net use their own hosted approval/authentication flows. An order is marked paid only after a provider confirmation is verified. Configure and test each provider in sandbox/test mode before enabling live payments.

After a provider returns the customer to the site, the thank-you page shows the customer name, order date/reference, VIN or license plate, and current payment/order status. These details are fetched through a limited per-order checkout token. The page also displays the configured customer message that order processing is underway and the report will be delivered within 30 minutes. Authorize.Net can return before its signed webhook arrives, so the page keeps checking until payment status updates.

## Secure report email setup

1. Create a Resend account and verify a sender domain in its dashboard.
2. Copy `.env.example` to `.env` if you have not already. Set `RESEND_API_KEY` to your Resend API key and `EMAIL_FROM` to a sender address on the verified domain.
3. Set `APP_BASE_URL` to your public HTTPS website origin (for example, `https://reports.example.com`). Do not use `127.0.0.1` for customer emails.
4. Save `.env` and restart the Node.js server.
5. In Admin → Orders, open an order, upload its PDF, then choose **Email secure portal link**. Resend’s accepted message ID is saved with the order.

When the customer opens the portal, they enter the order email address and receive a six-digit code. The portal returns a generic response for matching and non-matching addresses. A valid code unlocks a 30-minute session. The PDF is served from the server only after verification, and its request, completion or interruption, IP, browser category, device category, byte count, and verification method are recorded. Do not place raw report files in a public folder.

This project submits mail through the Resend HTTP API, which accepts a sender, recipient, subject, and message body. Configure provider credentials and a verified sender before using the workflow ([Resend email API](https://resend.com/features/email-api)). OTP handling follows OWASP guidance for short expiry, single use, attempt limits, and avoiding plaintext logging ([OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)).

### Test the portal locally without an email key

Set `PORTAL_TEST_MODE=true` in `.env`, keep `HOST=127.0.0.1`, and make sure `NODE_ENV` is not `production`. Restart the server, open a portal link on that computer, enter the matching order email, and use the local test code displayed on the page. This code is only returned when the server is bound to loopback and the request comes from localhost. Turn the flag off before production; production mode and public binds disable the test path.

### Test checkout and the thank-you page locally

Set `DEMO_CHECKOUT_ENABLED=true`, keep `HOST=127.0.0.1`, and make sure `NODE_ENV` is not `production`; then restart the server. At checkout choose **Demo checkout (no charge)**, enter sample values only, and complete the form. The entered card-like values are never sent to the server or saved. The demo event does not mark the order paid or count it as revenue. The server exposes this route only for a non-production loopback setup; set the flag back to `false` when finished.

## Website integrations

The admin sidebar includes **Payment Gateway** and **Live Chat & Countries**. The live chat settings accept a Tawk.to snippet but extract only its `embed.tawk.to` site/widget IDs; the customer page loads Tawk’s hosted widget using those IDs. Added checkout countries are published from saved site settings and validated by the order API.

### Payment gateways

Stripe, PayPal, and Authorize.Net are supported through provider-hosted checkout. In Admin → Payment Gateway, enter the public site URL and each provider’s test/sandbox credentials, save, and enable only the providers you are ready to offer. Secret values are saved in the server’s private `.env` file and are not returned to the admin browser. They are not encrypted; keep `.env` and server backups private. Restart the server after changing `.env` directly.

For each enabled provider, register the displayed webhook URL in that provider’s dashboard, select the event types listed under the provider in Admin, and paste the signing secret or webhook ID back into the admin settings. The site must be reachable over HTTPS for providers to call webhooks. Use the provider’s sandbox/test environment to place a complete test order and confirm the provider dashboard and order record agree before switching to live credentials. Live processing also depends on the merchant account being approved and configured by the provider.

Stripe uses Checkout Sessions and webhook signature verification ([Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhooks](https://docs.stripe.com/webhooks)). PayPal uses Orders v2 and verifies webhook events with PayPal ([Orders API](https://developer.paypal.com/docs/api/orders/v2/), [webhook verification](https://developer.paypal.com/docs/api/rest/webhooks/)). Authorize.Net uses Accept Hosted and verifies signed webhook notifications ([Accept Hosted](https://developer.authorize.net/api/reference/features/accept-hosted.html), [webhooks](https://developer.authorize.net/api/reference/features/webhooks.html)).


## Search engine setup

The public home page includes a search title and description, a brand favicon, server-rendered FAQ text, and schema.org organization/service metadata. `/robots.txt` excludes the admin, API, report portal, and payment routes. `/sitemap.xml` advertises the canonical home URL after a public HTTPS `APP_BASE_URL` is configured.

Set `APP_BASE_URL` to the site's final HTTPS origin (choose either the `www` or non-`www` hostname and redirect the other to it). Restart the server, then confirm that `/robots.txt` and `/sitemap.xml` load on the public domain. Add and verify the domain in Google Search Console and submit `https://your-domain/sitemap.xml`; request indexing for the home page. Search Console access and public deployment are required for those last steps. Crawling and indexing are not guaranteed and can take time.
