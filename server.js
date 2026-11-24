const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VehiclePricing = require('./pricing-engine');

const ROOT = __dirname;
const ENV_FILE = process.env.APP_ENV_FILE ? path.resolve(process.env.APP_ENV_FILE) : path.join(ROOT, '.env');
const STORE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const STORE_FILE = path.join(STORE_DIR, 'store.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(ROOT, 'uploads');
const REPORT_DIR = process.env.REPORT_DIR ? path.resolve(process.env.REPORT_DIR) : path.join(ROOT, 'reports');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const persistentConfigFile = Boolean(process.env.APP_ENV_FILE);
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && (persistentConfigFile || process.env[match[1]] === undefined)) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
loadEnvFile();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 14) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 14 characters) in .env before starting the admin server.');
  process.exit(1);
}
let passwordSalt = crypto.randomBytes(32);
let passwordDigest = crypto.scryptSync(ADMIN_PASSWORD, passwordSalt, 64);
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'vintrue_admin';
const PORTAL_COOKIE = 'vintrue_report';
const portalChallenges = new Map();
const portalSessions = new Map();
const portalLimits = new Map();
const PORTAL_CODE_MS = 10 * 60 * 1000;
const PORTAL_SESSION_MS = 30 * 60 * 1000;
const statuses = ['payment_pending', 'paid', 'reporting', 'complete', 'delivered', 'refunded', 'chargeback', 'cancelled'];
const supportedCurrencies = new Set(['USD','CAD','GBP','EUR']);
function validCurrency(value) { const currency=String(value||'USD').trim().toUpperCase(); if(!supportedCurrencies.has(currency)) throw Object.assign(new Error('Choose USD, CAD, GBP, or EUR.'),{status:400}); return currency; }
function isNetherlands(country) { return ['netherlands','the netherlands','nederland','neatherland','nl'].includes(String(country||'').trim().toLowerCase()); }
const initialPackages = [
  { id: 'basic', name: 'Basic', price: 44.95, tag: 'A clear starting point', description: 'Get the core available vehicle details in one easy-to-read report.', features: ['Vehicle specifications', 'Accident information', 'Owner history', 'Safety recalls', 'Market value range'] },
  { id: 'gold', name: 'Gold', price: 89.95, tag: 'More context for your research', description: 'Build on the Basic report with additional listing, warranty, equipment, and salvage information when available.', features: ['Everything in Basic', 'Online listing history', 'Warranty information', 'Installed equipment', 'Salvage information'] },
  { id: 'platinum', name: 'Platinum', price: 99.95, tag: 'A broader vehicle history view', description: 'Bring together available records in a more detailed package to support your next questions.', featured: true, features: ['Everything in Gold', 'Theft & recovery records', 'Detailed ownership costs', 'Vehicle history overview', '3 vehicle reports'] },
  { id: 'diamond', name: 'Diamond', price: 129.95, tag: 'A deeper look at key records', description: 'Review additional ownership, accident, theft, recall, and listing details when available.', features: ['Ownership costs', 'Accident information', 'Theft & recovery records', 'Safety recall status', 'Online listing history'] },
  { id: 'ruby', name: 'Ruby', price: 239.95, tag: 'More records to explore', description: 'A broader set of vehicle history details for shoppers who want to research further.', features: ['Ownership costs & history', 'Accident information', 'Market value range', 'Safety recalls & warranties', 'Theft & recovery records'] },
  { id: 'sapphire', name: 'Sapphire', price: 499.95, tag: 'Our most detailed report option', description: 'Explore an extensive set of available vehicle history and ownership records.', features: ['Two buyer numbers', 'Ownership costs & history', 'Accident information', 'Safety recalls & warranties', 'Theft & recovery records'] },
  { id: 'window-sticker', name: 'Window Sticker', price: 29.99, tag: 'Original equipment', description: 'See original factory details for eligible vehicles.', features: ['Vehicle window label verification', 'Original equipment details', 'Digital delivery', 'Fast turnaround', 'Covers most vehicles'] },
  { id: 'salvage-information', name: 'Salvage Information', price: 149, tag: 'Title & repair details', description: 'Review salvage and rebuilt vehicle information.', features: ['Repair cost value', 'Road legal status', 'Rebuilt status', 'Resale value context', 'Financing considerations'] },
  { id: 'service-maintenance-records', name: 'Service & Maintenance Records', price: 399.99, tag: 'Maintenance overview', description: 'Explore the available service and maintenance timeline.', features: ['Service history timeline', 'Total maintenance cost', 'Service frequency', 'Vehicle health report', 'Cost tracking & documentation'] }
];
const defaultFooter = {
  heading: 'Vehicle research, made clearer.', subheading: 'Straightforward vehicle history reports to help you ask better questions before your next purchase.',
  contactHeading: 'Contact', contactEmail: '', contactPhone: '',
  exploreHeading: 'Explore', exploreLinks: [{ label: 'Pricing', href: '#pricing-page' }, { label: 'How it works', href: '#how-it-works' }, { label: 'Our data sources', href: '#sources' }, { label: 'FAQ', href: '#faq' }],
  companyHeading: 'Company & policies', companyLinks: [{ label: 'About Us', href: '#about-us' }, { label: 'Terms & Conditions', href: '#terms' }, { label: 'Privacy Policy', href: '#privacy' }, { label: 'Refund Policy', href: '#refund' }, { label: 'Cancellation Policy', href: '#cancellation' }],
  paymentIcons: ['Visa', 'Mastercard', 'PayPal', 'Apple Pay'], copyright: '© 2026 VINtrue. All rights reserved.'
};
const defaultFaqs = [
  { question: 'What information do I need to get started?', answer: 'Enter a 17-character VIN or choose the license plate option. You’ll add your contact details and select a package before checkout.' },
  { question: 'Where can I find my VIN?', answer: 'Look at the driver-side dashboard through the windshield, the label inside the driver-side door, or your vehicle registration and insurance documents.' },
  { question: 'What can a vehicle report include?', answer: 'Package contents vary. Depending on the package and records available, a report may include specifications, title or salvage information, accident history, recalls, ownership details, past listings, or service records. Review each package description before choosing.' },
  { question: 'Will the report show every event in the vehicle’s history?', answer: 'No report can guarantee a complete history. Records may be incomplete, delayed, or unavailable. Use the report as one research tool alongside official documents and an independent inspection.' },
  { question: 'How long does delivery take?', answer: 'We process orders as quickly as possible. Delivery timing can vary depending on the package and available vehicle records.' },
  { question: 'How does 3D Secure payment approval work?', answer: 'Your card issuer may ask you to confirm the transaction with a one-time code or a prompt in your banking app. Follow your bank’s instructions to approve the payment.' },
  { question: 'Can I get a refund?', answer: 'Please review our Refund Policy before placing an order. If you have an issue with an order, contact customer support using the details provided at checkout.' }
];
const defaultPolicyPages = {
  'about-us': '## Helping you make a considered choice\n\nVINtrue is designed to make vehicle history easier to understand. We bring available vehicle records together in one straightforward report so shoppers can ask better questions before buying.\n\n## Information for your next step\n\nReports may include vehicle specifications, accident and title information, ownership records, recalls, past listings, and other details when available. Every vehicle has its own record history, and the information available can vary.\n\n## Use reports thoughtfully\n\nA report is a useful starting point, not a substitute for a professional inspection, a test drive, or checking official vehicle documents. If something matters to your decision, confirm it with the relevant authority or a qualified mechanic.',
  terms: '## Using VINtrue\n\nBy using this website or purchasing a report, you agree to use the service lawfully and provide accurate information. You must be authorized to submit any vehicle details you enter.\n\n## Reports and data availability\n\nVehicle reports compile information from third-party and public records. Records can be incomplete, delayed, or unavailable. VINtrue does not guarantee that a report contains every event in a vehicle’s history or that all information is error-free. Reports are for general informational purposes and are not a substitute for an independent vehicle inspection, an official title search, or professional advice.\n\n## Orders and service\n\nPackage contents and prices are displayed before purchase. Please check your VIN or plate details and selected package before placing an order. A submitted order authorizes the selected payment method to be charged the displayed total.\n\n## Acceptable use\n\nYou agree not to misuse the website, attempt unauthorized access, interfere with service availability, or use vehicle information in ways prohibited by applicable law.\n\n## Contact\n\nQuestions about these terms can be sent to support@vintrue.example.',
  privacy: '## Information you provide\n\nTo help prepare a vehicle report, we may process the VIN or license plate you submit, your contact information, and the information needed to complete your order. When you visit, your browser may ask to access your device location. A successful location reading is required to submit an order; we store the coordinates and reported accuracy with the order. Location access requires your browser permission and a secure (HTTPS or localhost) connection.\n\n## Device and order records\n\nWhen an order is submitted, we record the request IP address and derived browser, device, and platform categories. We also retain order creation and completion times, report delivery records, and report-link access logs to operate the service, prevent fraud, and respond to disputes.\n\n## How information is used\n\nWe use submitted information to provide the requested report, process payment, respond to support requests, protect the service, and meet applicable legal requirements.\n\n## Service providers\n\nInformation may be shared with service providers that help process payments, retrieve vehicle records, deliver reports, and operate the website.\n\n## Retention and security\n\nWe keep order and support information for as long as reasonably needed to provide the service, resolve disputes, and meet legal obligations.\n\n## Your choices\n\nLocation sharing is optional. You can decline the browser prompt and still place an order. For questions about personal information or to request access or correction where applicable, contact support@vintrue.example.\n\n## Updates\n\nWe may update this policy as our services change. The date above shows when the latest version was published.',
  cancellation: '## Cancellation requests\n\nContact customer support promptly if you want to cancel an order. Requests are reviewed based on the order and report preparation status, subject to applicable law.\n\n## Digital delivery\n\nA vehicle inspection report is a digital product. Once delivered, it cannot be returned, as disclosed during checkout.\n\n## Contact\n\nEmail allvinreport@gmail.com with your order reference and the email address used at checkout.',
  refund: '## When a report order may qualify\n\nIf a paid report cannot be delivered because of a technical issue on our side, or submitted vehicle details cannot be processed, contact customer support. We will review the order and, where appropriate, arrange a replacement report or refund.\n\n## How to request help\n\nEmail support@vintrue.example with your order reference, the email used at checkout, and a short description of the issue. Please do not include full payment-card details.\n\n## Order review\n\nBecause a vehicle report is a digital service prepared using submitted vehicle details, requests made after report delivery are reviewed individually. Duplicate charges and paid orders that were not fulfilled will be investigated.\n\n## Refund timing\n\nOnce approved, refunds are sent to the original payment method. Your bank or payment provider controls how long the credit takes to appear.\n\n## Before you order\n\nPlease carefully check your VIN or license plate and selected package before payment. Report availability varies by vehicle and data source.'
};
const TERMS_VERSION = 'vintrue-terms-2026-10-30-v2';
const TERMS_SNAPSHOT = {
  terms: 'I agree to the Terms & Conditions, Privacy Policy, Refund Policy, and Cancellation Policy.',
  decision: "We don't promise you a date to buy the vehicle, you should do it on your own decision.",
  digitalDelivery: 'I am purchasing a VEHICLE INSPECTION REPORT which will be delivered within the specified timeframe once the payment is processed (acknowledging that once the report is delivered, it cannot be returned).'
};
const TERMS_SNAPSHOT_NL = {
  terms: 'Ik ga akkoord met de algemene voorwaarden, privacyverklaring, restitutiebeleid en annuleringsbeleid.',
  decision: 'Wij beloven geen datum waarop u het voertuig moet kopen; die beslissing neemt u zelf.',
  digitalDelivery: 'Ik koop een VOERTUIGINSPECTIERAPPORT dat binnen de aangegeven termijn na verwerking van de betaling wordt geleverd. Ik begrijp dat het rapport na levering niet kan worden geretourneerd.'
};function defaults() { return { settings: { currency: 'EUR', packages: initialPackages, pricingRules: { windowStickerDiscountPercentByPackage: {} }, logoText: 'vintrue', logoUrl: '', footer: defaultFooter, faqs: defaultFaqs, policyPages: defaultPolicyPages, reviews: [], countries: ['Netherlands'], tawk: { enabled: false, siteId: '', widgetId: '' } }, orders: [], logs: [], agents: [], orderPrefix: 'AVR', orderDailyCounts: {} }; }
function readStore() {
  if (!fs.existsSync(STORE_FILE)) return defaults();
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); if (!Array.isArray(data.agents)) data.agents = [];
    data.settings ||= defaults().settings; data.settings.currency = supportedCurrencies.has(String(data.settings.currency || 'USD').toUpperCase()) ? String(data.settings.currency || 'USD').toUpperCase() : 'USD'; data.settings.pricingRules ||= { windowStickerDiscountPercentByPackage: {} }; data.settings.faqs = validFaqs(data.settings.faqs || defaultFaqs); data.settings.reviews = validReviews(data.settings.reviews || []); data.settings.policyPages = validPolicyPages(data.settings.policyPages || defaultPolicyPages); data.settings.countries = validCountries(data.settings.countries || ['Netherlands']); data.settings.tawk = validTawk(data.settings.tawk || {});
    data.orderPrefix = cleanString(data.orderPrefix || 'AVR', 8).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AVR';
    const orders = Array.isArray(data.orders) ? data.orders : [], counts = {};
    for (const order of [...orders].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
      const day = String(order.createdAt || new Date().toISOString()).slice(0, 10), existing = String(order.orderNumber || '');
      const match = existing.match(/^[A-Z0-9]+-[A-Z0-9]{1,2}-(\d{4}-\d{2}-\d{2})-(\d+)$/);
      if (match && match[1] === day) counts[day] = Math.max(counts[day] || 0, Number(match[2]));
      else { const number = (counts[day] || 0) + 1; counts[day] = number; order.orderNumber = makeOrderNumber(data.orderPrefix, order.fullName, day, number); }
      if (!order.id) order.id = crypto.randomUUID();
    }
    data.orderDailyCounts = { ...counts, ...(data.orderDailyCounts || {}) };
    for (const order of data.orders || []) {
      const createdLog = (data.logs || []).find(x => x.action === 'order.created' && x.detail?.orderId === order.id);
      if (!order.consentAt && order.consentAccepted) order.consentAt = order.createdAt;
      if (!order.client) order.client = {};
      if (!order.client.ipAddress && createdLog?.ip) order.client.ipAddress = createdLog.ip;
      const oldUa = order.client.userAgent || createdLog?.userAgent || '';
      if (oldUa) Object.assign(order.client, classifyUserAgent(oldUa));
      delete order.client.userAgent; delete order.consentClientAt;
      if (!Array.isArray(order.events)) order.events = [];
      if (!Array.isArray(order.downloadEvents)) order.downloadEvents = [];
      if (!order.paymentEvidence) order.paymentEvidence = { provider: '', transactionId: '', paymentIntentId: '', status: '', authorizedAt: '', threeDSecure: '', avsResult: '', cvvResult: '', cardBrand: '', cardLast4: '' };
      if (!order.packageSnapshot) order.packageSnapshot = { id: order.packageId, name: order.packageName, price: Number(order.amount || 0), currency: order.currency || 'USD', description: '', features: [] };
      if (!order.consentSnapshot && order.consentAccepted) order.consentSnapshot = { version: 'legacy', acceptedAt: order.consentAt || order.createdAt, copy: TERMS_SNAPSHOT };
      if (!order.reportEvidence) order.reportEvidence = { sha256: '', sizeBytes: 0, uploadedBy: '', sentTo: order.email || '', deliveryChannel: '' };
      if (order.reportFile) { const reportPath = path.join(REPORT_DIR, path.basename(order.reportFile)); if (reportPath.startsWith(REPORT_DIR) && fs.existsSync(reportPath)) { const reportBytes = fs.readFileSync(reportPath); order.reportEvidence.sha256 ||= crypto.createHash('sha256').update(reportBytes).digest('hex'); order.reportEvidence.sizeBytes ||= reportBytes.length; } }
      for (const event of [...order.events, ...order.downloadEvents]) delete event.userAgent;
    }
    for (const item of data.logs || []) delete item.userAgent;
    return data;
  } catch { throw new Error('data/store.json is invalid JSON; repair or restore it before starting.'); }
}
let store = readStore();
function writeStore(next) { fs.mkdirSync(STORE_DIR, { recursive: true }); const temp = STORE_FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(temp, STORE_FILE); }
function log(action, detail = {}, req = null) {
  store.logs.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), action, detail, ip: req ? clientIp(req) : 'local' });
  store.logs = store.logs.slice(0, 2000); writeStore(store);
}
function send(res, status, body, headers = {}) { const payload = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length, 'Cache-Control': 'no-store', ...headers }); res.end(payload); }
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(c => c.length === 2)); }
function body(req, max = 1024 * 1024) { return new Promise((resolve, reject) => { let size = 0, chunks = []; req.on('data', chunk => { size += chunk.length; if (size > max) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } }); req.on('error', reject); }); }
function rawBody(req, max = 1024 * 1024) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; req.on('data', chunk => { size += chunk.length; if (size > max) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
function sessionFor(req) { const sid = parseCookies(req)[COOKIE], session = sid && sessions.get(sid); if (!session || session.expires < Date.now()) { if (sid) sessions.delete(sid); return null; } session.expires = Date.now() + SESSION_MS; return session; }
function authorized(req, res) { const session = sessionFor(req); if (!session) { send(res, 401, { error: 'Please sign in.' }); return null; } if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) { send(res, 403, { error: 'Security token expired. Refresh and try again.' }); return null; } return session; }
function cleanString(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function clientIp(req) { const direct = req.socket.remoteAddress || 'unknown', forwarded = process.env.TRUST_PROXY === 'true' ? cleanString((req.headers['x-forwarded-for'] || '').split(',')[0], 100) : ''; const ip = forwarded || direct; return ip.startsWith('::ffff:') ? ip.slice(7) : ip === '::1' ? '127.0.0.1' : ip; }
function classifyUserAgent(ua) { const chrome = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/); const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /Firefox\//.test(ua) ? 'Firefox' : chrome ? `Google Chrome ${chrome[1].split('.')[0]}` : /Safari\//.test(ua) ? 'Safari' : 'Other / unknown'; const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop'; const platform = /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown'; return { browser, device, platform }; }
function clientFacts(req) { const ua = cleanString(req.headers['user-agent'] || '', 500); return { ipAddress: clientIp(req), ...classifyUserAgent(ua) }; }
function portalCookieOptions(maxAge) { return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function portalSessionFor(req, token) { const sid = parseCookies(req)[PORTAL_COOKIE], session = sid && portalSessions.get(sid); if (!session || session.expires < Date.now() || session.token !== token) { if (sid) portalSessions.delete(sid); return null; } return session; }
function localPortalTestMode(req) { const host = (process.env.HOST || '127.0.0.1').toLowerCase(); return process.env.NODE_ENV !== 'production' && process.env.PORTAL_TEST_MODE === 'true' && ['127.0.0.1', 'localhost', '::1'].includes(host) && ['127.0.0.1', '::1'].includes(clientIp(req)); }
function portalEvent(order, type, req, extra = {}) { const at = new Date().toISOString(), facts = clientFacts(req); if (!Array.isArray(order.events)) order.events = []; order.events.push({ at, type, ipAddress: facts.ipAddress, browser: facts.browser, device: facts.device, platform: facts.platform, ...extra }); writeStore(store); return { at, facts }; }
function portalRateLimited(key, max = 5, windowMs = 15 * 60 * 1000) { const now = Date.now(), old = portalLimits.get(key); if (!old || old.until <= now) { portalLimits.set(key, { count: 1, until: now + windowMs }); return false; } old.count++; return old.count > max; }
async function sendEmail(to, subject, textBody, htmlBody) {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text: textBody, html: htmlBody }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(`Email provider rejected the message (${response.status}).`);
  return result.id;
}
function accessClassification(req) { const ua = cleanString(req.headers['user-agent'] || '', 500); return /bot|crawler|spider|preview|scanner|proofpoint|mimecast|safelinks|barracuda|linkcheck|headless|curl\/|wget\//i.test(ua) ? 'likely_automated' : 'browser_or_app'; }
function evidenceChecklist(order) {
  const completedDownloads = (order.downloadEvents || []).filter(x => x.completedAt && x.accessType !== 'likely_automated').length;
  const checks = [
    { key: 'purchase_record', label: 'Order and package snapshot', complete: Boolean(order.createdAt && order.packageSnapshot?.name) },
    { key: 'consent', label: 'Server-timestamped policy consent', complete: Boolean(order.consentAccepted && order.consentAt && order.consentSnapshot?.version) },
    { key: 'purchase_device', label: 'Checkout IP and device details', complete: Boolean(order.client?.ipAddress && order.client?.browser && order.client?.device) },
    { key: 'payment', label: 'Processor payment and authentication evidence', complete: Boolean(order.paymentEvidence?.transactionId && ['paid', 'succeeded', 'authorized', 'partially_refunded', 'refunded', 'chargeback'].includes(String(order.paymentEvidence?.status || '').toLowerCase())) },
    { key: 'report_file', label: 'Report file and integrity hash', complete: Boolean(order.reportFile && order.reportEvidence?.sha256 && order.reportUploadedAt) },
    { key: 'delivery', label: 'Report delivery recorded', complete: Boolean(order.reportSentAt && order.reportEvidence?.sentTo) },
    { key: 'access', label: 'Completed non-automated report download', complete: completedDownloads > 0 }
  ];
  const done = checks.filter(x => x.complete).length;
  return { checks, done, total: checks.length, completedDownloads, likelyAutomatedDownloads: (order.downloadEvents || []).filter(x => x.completedAt && x.accessType === 'likely_automated').length, label: done === checks.length ? 'All configured evidence recorded' : done >= 5 ? 'Several evidence items recorded' : 'Evidence gaps remain' };
}
function customerInitials(name) { const words = cleanString(name, 120).split(/\s+/).filter(Boolean); return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || 'CU').slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CU'; }
function makeOrderNumber(prefix, name, day, sequence) { return `${prefix}-${customerInitials(name)}-${day}-${String(sequence).padStart(2, '0')}`; }
function validPackageList(value) {
  if (!Array.isArray(value) || value.length > 50) throw Object.assign(new Error('Packages must be a list with no more than 50 items.'), { status: 400 });
  const ids = new Set();
  return value.map(p => {
    const id = cleanString(p.id, 60).toLowerCase(), name = cleanString(p.name, 80), price = Number(p.price), tag = cleanString(p.tag, 100), description = cleanString(p.description, 500);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw Object.assign(new Error('Each package needs a unique, URL-safe ID.'), { status: 400 });
    if (!name || !Number.isFinite(price) || price < 0 || price > 100000) throw Object.assign(new Error('Enter a package name and a valid non-negative price.'), { status: 400 });
    ids.add(id);
    const features = Array.isArray(p.features) ? p.features.slice(0, 20).map(x => cleanString(x, 180)).filter(Boolean) : [];
    return { id, name, price: Math.round(price * 100) / 100, tag, description, features, featured: Boolean(p.featured) };
  });
}
function validLinks(value) { if (!Array.isArray(value) || value.length > 30) throw Object.assign(new Error('Footer links must be a list of up to 30 entries.'), { status: 400 }); return value.map(x => { const label = cleanString(x.label, 60), href = cleanString(x.href, 300); if (!label || !/^(#|https:\/\/|mailto:)/i.test(href)) throw Object.assign(new Error('Footer links must use an on-site anchor, HTTPS URL, or email link.'), { status: 400 }); return { label, href }; }); }
function validFooter(f) { return {
  heading: cleanString(f.heading, 100), subheading: cleanString(f.subheading, 500), contactHeading: cleanString(f.contactHeading, 80), contactEmail: cleanString(f.contactEmail, 120), contactPhone: cleanString(f.contactPhone, 60),
  exploreHeading: cleanString(f.exploreHeading, 80), exploreLinks: validLinks(f.exploreLinks), companyHeading: cleanString(f.companyHeading, 80), companyLinks: validLinks(f.companyLinks),
  paymentIcons: Array.isArray(f.paymentIcons) ? f.paymentIcons.slice(0, 20).map(x => cleanString(x, 40)).filter(Boolean) : [], copyright: cleanString(f.copyright, 200)
}; }
function validCountries(value) {
  if (!Array.isArray(value) || value.length > 100) throw Object.assign(new Error('Countries must be a list of up to 100 names.'), { status: 400 });
  const values = value.map(x => cleanString(x, 80)).filter(Boolean).map(name => name.toLowerCase() === 'neatherland' ? 'Netherlands' : name), seen = new Set();
  return values.filter(name => { const key = name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
function validFaqs(value) {
  if (!Array.isArray(value) || value.length > 30) throw Object.assign(new Error('FAQs must be a list with no more than 30 entries.'), { status: 400 });
  return value.map(item => ({ question: cleanString(item.question, 240), answer: cleanString(item.answer, 1200) })).filter(item => item.question && item.answer);
}
function validReviews(value) {
  if (!Array.isArray(value) || value.length > 200) throw Object.assign(new Error('Reviews must be a list of up to 200 entries.'), { status: 400 });
  return value.map(item => {
    const rating = item.rating === null || item.rating === '' || item.rating === undefined ? null : Number(item.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw Object.assign(new Error('Review rating must be between 1 and 5 stars.'), { status: 400 });
    return { id: cleanString(item.id || crypto.randomUUID(), 80), name: cleanString(item.name, 80), location: cleanString(item.location, 100), rating, text: cleanString(item.text, 1600), published: item.published !== false };
  }).filter(item => item.name && item.text);
}
function validPolicyPages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Policy page content must be an object.'), { status: 400 });
  return Object.fromEntries(Object.entries(defaultPolicyPages).map(([key, fallback]) => [key, typeof value[key] === 'string' ? value[key].slice(0, 20000) : fallback]));
}
function validTawk(value) {
  if (value.enabled === false) return { enabled: false, siteId: '', widgetId: '' };
  if (/^[A-Za-z0-9_-]{1,80}$/.test(value.siteId || '') && /^[A-Za-z0-9_-]{1,80}$/.test(value.widgetId || '')) return { enabled: true, siteId: value.siteId, widgetId: value.widgetId };
  const raw = cleanString(value.script || '', 8000);
  if (!raw) return { enabled: false, siteId: '', widgetId: '' };
  const match = raw.match(/https:\/\/embed\.tawk\.to\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,80})/i);
  if (!match) throw Object.assign(new Error('Paste the standard Tawk.to embed code containing an embed.tawk.to site URL.'), { status: 400 });
  return { enabled: true, siteId: match[1], widgetId: match[2] };
}
const GATEWAY_KEYS = ['APP_BASE_URL','STRIPE_ENABLED','STRIPE_MODE','STRIPE_TEST_PUBLIC_KEY','STRIPE_TEST_SECRET_KEY','STRIPE_TEST_WEBHOOK_SECRET','STRIPE_LIVE_PUBLIC_KEY','STRIPE_LIVE_SECRET_KEY','STRIPE_LIVE_WEBHOOK_SECRET','STRIPE_PUBLIC_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PAYPAL_ENABLED','PAYPAL_MODE','PAYPAL_TEST_CLIENT_ID','PAYPAL_TEST_CLIENT_SECRET','PAYPAL_TEST_WEBHOOK_ID','PAYPAL_LIVE_CLIENT_ID','PAYPAL_LIVE_CLIENT_SECRET','PAYPAL_LIVE_WEBHOOK_ID','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','ANET_ENABLED','ANET_MODE','ANET_TEST_LOGIN_ID','ANET_TEST_TRANSACTION_KEY','ANET_TEST_SIGNATURE_KEY','ANET_LIVE_LOGIN_ID','ANET_LIVE_TRANSACTION_KEY','ANET_LIVE_SIGNATURE_KEY','ANET_LOGIN_ID','ANET_TRANSACTION_KEY','ANET_SIGNATURE_KEY','MOLLIE_ENABLED','MOLLIE_MODE','MOLLIE_TEST_API_KEY','MOLLIE_LIVE_API_KEY','MOLLIE_API_KEY'];
const gatewayModes = { stripe: ['test','live'], paypal: ['test','live'], authorize_net: ['test','live'], mollie: ['test','live'] };
const gatewayPrefixes = { stripe: 'STRIPE', paypal: 'PAYPAL', authorize_net: 'ANET', mollie: 'MOLLIE' };
function gatewayMode(id) {
  const prefix = gatewayPrefixes[id], legacy = id === 'paypal' ? 'sandbox' : 'test';
  if (!prefix) return 'test';
  if (id === 'mollie' && !process.env.MOLLIE_MODE) return (process.env.MOLLIE_API_KEY || '').startsWith('live_') ? 'live' : 'test';
  const mode = String(process.env[`${prefix}_MODE`] || legacy).toLowerCase();
  return mode === 'live' ? 'live' : 'test';
}
function gatewayCredential(id, mode, suffix) {
  const prefix = gatewayPrefixes[id]; if (!prefix) return '';
  const currentMode = gatewayMode(id), normalized = mode === 'live' ? 'live' : 'test';
  const scoped = process.env[`${prefix}_${normalized.toUpperCase()}_${suffix}`];
  if (scoped) return scoped;
  const legacySuffix = { PUBLIC_KEY:'PUBLIC_KEY', SECRET_KEY:'SECRET_KEY', WEBHOOK_SECRET:'WEBHOOK_SECRET', CLIENT_ID:'CLIENT_ID', CLIENT_SECRET:'CLIENT_SECRET', WEBHOOK_ID:'WEBHOOK_ID', LOGIN_ID:'LOGIN_ID', TRANSACTION_KEY:'TRANSACTION_KEY', SIGNATURE_KEY:'SIGNATURE_KEY', API_KEY:'API_KEY' }[suffix];
  return normalized === currentMode && legacySuffix ? process.env[`${prefix}_${legacySuffix}`] || '' : '';
}
function gatewayConfig(id, mode = gatewayMode(id)) {
  if (id === 'stripe') return { publicKey: gatewayCredential(id,mode,'PUBLIC_KEY'), secretKey: gatewayCredential(id,mode,'SECRET_KEY'), webhookSecret: gatewayCredential(id,mode,'WEBHOOK_SECRET') };
  if (id === 'paypal') return { clientId: gatewayCredential(id,mode,'CLIENT_ID'), clientSecret: gatewayCredential(id,mode,'CLIENT_SECRET'), webhookId: gatewayCredential(id,mode,'WEBHOOK_ID') };
  if (id === 'authorize_net') return { loginId: gatewayCredential(id,mode,'LOGIN_ID'), transactionKey: gatewayCredential(id,mode,'TRANSACTION_KEY'), signatureKey: gatewayCredential(id,mode,'SIGNATURE_KEY') };
  if (id === 'mollie') return { apiKey: gatewayCredential(id,mode,'API_KEY') };
  return {};
}
function gatewayRequirements(id, mode) {
  const c = suffix => gatewayCredential(id, mode, suffix), missing = [];
  if (id === 'stripe') { if (!c('PUBLIC_KEY')) missing.push('publishable key'); else if (!c('PUBLIC_KEY').startsWith(mode === 'live'?'pk_live_':'pk_test_')) missing.push(`${mode} publishable key`); if (!c('SECRET_KEY')) missing.push('secret key'); else if (!c('SECRET_KEY').startsWith(mode === 'live'?'sk_live_':'sk_test_')) missing.push(`${mode} secret key`); }
  if (id === 'paypal') { if (!c('CLIENT_ID')) missing.push('client ID'); if (!c('CLIENT_SECRET')) missing.push('client secret'); if (mode === 'live' && !c('WEBHOOK_ID')) missing.push('live webhook ID'); }
  if (id === 'authorize_net') { if (!c('LOGIN_ID')) missing.push('API Login ID'); if (!c('TRANSACTION_KEY')) missing.push('transaction key'); if (!c('SIGNATURE_KEY')) missing.push('webhook signature key'); }
  if (id === 'mollie') { const key = c('API_KEY'); if (!key) missing.push(`${mode} API key`); else if (mode === 'test' ? !key.startsWith('test_') : !key.startsWith('live_')) missing.push(`${mode} API key matching selected mode`); }
  if (mode === 'live' && !publicHttpsBase()) missing.push('public HTTPS website URL (APP_BASE_URL)');
  if (id === 'authorize_net' && !publicHttpsBase()) missing.push('public HTTPS website URL for payment notifications');
  if (mode === 'test' && ['stripe','paypal','mollie'].includes(id) && !usableCheckoutBase()) missing.push('checkout return URL in APP_BASE_URL (public HTTPS or local test URL)');
  return missing;
}
function publicHttpsBase() { try { const u = new URL(process.env.APP_BASE_URL || ''), host = u.hostname.toLowerCase(); return u.protocol === 'https:' && !['localhost','127.0.0.1','::1','your-domain.com','example.com','example.org','example.net'].includes(host) && !['.localhost','.local','.test','.example','.invalid'].some(suffix => host.endsWith(suffix)); } catch { return false; } }
function usableCheckoutBase() { if (publicHttpsBase()) return true; try { const u = new URL(process.env.APP_BASE_URL || ''); return u.protocol === 'http:' && ['localhost','127.0.0.1','::1'].includes(u.hostname); } catch { return false; } }
function gatewaySnapshot() {
  return Object.keys(gatewayPrefixes).map(id => {
    const prefix = gatewayPrefixes[id], mode = gatewayMode(id), enabled = process.env[`${prefix}_ENABLED`] === 'true', missing = gatewayRequirements(id, mode);
    const names = { stripe:'Stripe', paypal:'PayPal', authorize_net:'Authorize.Net', mollie:'Mollie' };
    const modeStatus = Object.fromEntries(gatewayModes[id].map(candidate => { const missing = gatewayRequirements(id, candidate), platformMissing = new Set(['public HTTPS website URL (APP_BASE_URL)','public HTTPS website URL for payment notifications','checkout return URL in APP_BASE_URL (public HTTPS or local test URL)']); return [candidate, { ready: missing.length === 0, missing, credentialsSaved: missing.every(reason => platformMissing.has(reason)) }]; }));
    return { id, name: names[id], enabled: enabled && missing.length === 0, configuredEnabled: enabled, mode, missing, modeStatus };
  });
}
function saveGatewayEnvironment(values) {
  const file = ENV_FILE, existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [], output = [], seen = new Set();
  for (const line of existing) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (match && Object.hasOwn(values, match[1])) { if (!seen.has(match[1])) output.push(`${match[1]}=${String(values[match[1]]).replace(/[\r\n]/g, '')}`); seen.add(match[1]); }
    else output.push(line);
  }
  for (const key of GATEWAY_KEYS) if (Object.hasOwn(values, key) && !seen.has(key)) output.push(`${key}=${String(values[key]).replace(/[\r\n]/g, '')}`);
  fs.writeFileSync(file, output.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 }); fs.chmodSync(file, 0o600);
  for (const [key, value] of Object.entries(values)) process.env[key] = String(value);
}
function applyPaymentSuccess(order, provider, transactionId, details = {}) {
  if (!order || ['refunded', 'chargeback', 'cancelled', 'delivered'].includes(order.status) || (['paid','complete'].includes(order.status) && order.paymentEvidence?.status === 'succeeded')) return false;
  order.status = 'complete'; const at = new Date().toISOString(); order.completedAt ||= at; order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, transactionId, status: 'succeeded', authorizedAt: at, ...details };
  if (!Array.isArray(order.events)) order.events = []; order.events.push({ at, type: 'payment_confirmed', provider, transactionId, ipAddress: 'payment_provider' }, { at, type: 'order_completed', provider, transactionId, ipAddress: 'payment_provider' }); log('payment.confirmed', { orderId: order.orderNumber || order.id, provider, transactionId }); log('order.completed', { orderId: order.orderNumber || order.id, provider, transactionId }); return true;
}
function applyPaymentRefund(order, provider, transactionId, refundAmount, eventId) { if(!order)return; const previous=Number(order.paymentEvidence?.refundedAmount||0), amount=Math.max(0,Number(refundAmount)||0), total=Math.min(Number(order.amount||0),previous+amount); order.paymentEvidence={...(order.paymentEvidence||{}),provider,transactionId:transactionId||order.paymentEvidence?.transactionId||'',refundedAmount:total,status:total>=Number(order.amount||0)?'refunded':'partially_refunded'}; if(total>=Number(order.amount||0))order.status='refunded'; if(!Array.isArray(order.events))order.events=[]; order.events.push({at:new Date().toISOString(),type:total>=Number(order.amount||0)?'payment_refunded':'payment_partially_refunded',provider,transactionId,refundAmount:amount,totalRefunded:total,providerEventId:eventId,ipAddress:'payment_provider'}); if(eventId){order.gatewayEventIds||=[];order.gatewayEventIds.push(eventId)} log(total>=Number(order.amount||0)?'payment.refunded':'payment.partially_refunded',{orderId:order.orderNumber||order.id,provider,transactionId,refundAmount:amount,totalRefunded:total,providerEventId:eventId}); }
function applyPaymentLoss(order, status, provider, transactionId, eventId) { if (!order || !['refunded','chargeback'].includes(status)) return; order.status = status; order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, transactionId: transactionId || order.paymentEvidence?.transactionId || '', status }; if (!Array.isArray(order.events)) order.events = []; order.events.push({ at: new Date().toISOString(), type: status === 'refunded' ? 'payment_refunded' : 'payment_disputed', provider, transactionId, providerEventId: eventId, ipAddress: 'payment_provider' }); order.gatewayEventIds ||= []; if (eventId) order.gatewayEventIds.push(eventId); log(`payment.${status}`, { orderId: order.orderNumber || order.id, provider, transactionId, providerEventId: eventId }); }
async function providerJson(url, options = {}) {
  const response = await fetch(url, options), data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || data.messages?.message?.[0]?.text || `Payment provider request failed (${response.status}).`);
  return data;
}
async function stripeJsonWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, options), data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error?.message || ('Stripe request failed (' + response.status + ').'));
        error.status = response.status;
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else return data;
    } catch (error) {
      if (error.status && error.status !== 429 && error.status < 500) throw error;
      lastError = error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
  }
  const code = lastError?.cause?.code;
  if (lastError?.message === 'fetch failed' || code) throw new Error('Stripe connection failed after 3 attempts' + (code ? ' (' + code + ')' : '') + '.');
  throw lastError || new Error('Stripe checkout could not be reached.');
}async function molliePayment(paymentId) {
  const order = store.orders.find(item => item.molliePaymentId === paymentId), key = gatewayConfig('mollie',order?.paymentMode||gatewayMode('mollie')).apiKey;
  if (!key) throw new Error('Mollie API key for this payment mode is not configured.');
  return providerJson(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
}
function reconcileMolliePayment(payment) {
  const order = store.orders.find(item => item.molliePaymentId === payment.id && item.id === payment.metadata?.orderId);
  if (!order || String(payment.amount?.currency || '').toUpperCase() !== String(order.currency || 'USD').toUpperCase() || Math.round(Number(payment.amount?.value) * 100) !== Math.round(Number(order.amount) * 100)) return false;
  const status = String(payment.status || ''), evidence = order.paymentEvidence || {};
  if (status === 'paid' && evidence.status !== 'succeeded') applyPaymentSuccess(order, 'mollie', payment.id, { molliePaymentId: payment.id, paymentMethod: payment.method || '', checkoutUrl: payment._links?.checkout?.href || '' });
  else if (status === 'refunded' && evidence.status !== 'refunded') applyPaymentRefund(order, 'mollie', payment.id, Number(payment.amountRefunded?.value || order.amount), `mollie:${payment.id}:refunded`);
  else if (status === 'charged_back' && order.status !== 'chargeback') applyPaymentLoss(order, 'chargeback', 'mollie', payment.id, `mollie:${payment.id}:charged_back`);
  else if (['canceled','expired','failed'].includes(status) && !['succeeded','refunded','partially_refunded'].includes(evidence.status)) order.paymentEvidence = { ...evidence, provider: 'mollie', status: `checkout_${status}` };
  else return false;
  writeStore(store); return true;
}
async function paypalAccessToken(mode = gatewayMode('paypal')) {
  const config = gatewayConfig('paypal',mode), base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com', auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }), data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('PayPal authentication failed. Check the client ID and secret.'); return { base, token: data.access_token };
}
async function stripeEvidence(paymentIntentId, mode = gatewayMode('stripe')) { const secret = gatewayConfig('stripe',mode).secretKey; if (!paymentIntentId || !secret) return {}; const intent = await providerJson(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`, { headers: { Authorization: `Bearer ${secret}` } }), card = intent.latest_charge?.payment_method_details?.card; return { paymentIntentId, threeDSecure: card?.three_d_secure?.result || '', cardBrand: card?.brand || '', cardLast4: card?.last4 || '', avsResult: card?.checks?.address_postal_code_check || '', cvvResult: card?.checks?.cvc_check || '' }; }
async function anetRequest(action, payload, mode = gatewayMode('authorize_net')) {
  const base = mode === 'live' ? 'https://api.authorize.net/xml/v1/request.api' : 'https://apitest.authorize.net/xml/v1/request.api';
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [action]: payload }) }), text = (await response.text()).replace(/^\uFEFF/, '');
  let data; try { data = JSON.parse(text); } catch { throw new Error('Authorize.Net returned an unreadable response.'); }
  const result = data[action.replace('Request', 'Response')] || data;
  if (!response.ok || result.messages?.resultCode !== 'Ok' || (result.messages?.message || []).some(x => String(x.code || '').startsWith('E'))) throw new Error(result.messages?.message?.[0]?.text || `Authorize.Net request failed (${response.status}).`);
  return result;
}
function timingSafeHex(expected, actual) { if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) return false; return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex')); }
function paymentResultPage(title, text) { const safe = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7f4;color:#203a2b;display:grid;place-items:center;min-height:90vh"><main style="max-width:560px;background:white;padding:32px;border:1px solid #dfe8df;border-radius:16px"><h1>${safe(title)}</h1><p>${safe(text)}</p><a href="/">Return to VINtrue</a></main></body></html>`; return html; }
function redirectThankYou(res, order) {
  if (!order) { res.writeHead(303, { Location: '/' }); res.end(); return; }
  res.writeHead(303, { Location: '/Thank-you', 'Cache-Control': 'no-store' }); res.end();
}
function safeEqual(candidate) { const digest = crypto.scryptSync(candidate, passwordSalt, 64); return crypto.timingSafeEqual(digest, passwordDigest); }
function demoCheckoutEnabled(req = null) { const loopbackHosts = ['127.0.0.1', 'localhost', '::1']; return process.env.DEMO_CHECKOUT_ENABLED === 'true' && process.env.NODE_ENV !== 'production' && loopbackHosts.includes(HOST.toLowerCase()) && (!req || ['127.0.0.1', '::1'].includes(clientIp(req))); }
function persistAdminPassword(password) {
  const file = ENV_FILE, lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [], output = []; let replaced = false;
  for (const line of lines) { if (/^\s*ADMIN_PASSWORD\s*=/.test(line)) { if (!replaced) output.push(`ADMIN_PASSWORD=${password}`); replaced = true; } else output.push(line); }
  if (!replaced) output.push(`ADMIN_PASSWORD=${password}`);
  fs.writeFileSync(file, output.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 }); fs.chmodSync(file, 0o600);
  ADMIN_PASSWORD = password; process.env.ADMIN_PASSWORD = password; passwordSalt = crypto.randomBytes(32); passwordDigest = crypto.scryptSync(password, passwordSalt, 64);
}
function loginBlocked(ip) { const record = loginAttempts.get(ip); return record && record.count >= 5 && record.until > Date.now(); }
function staticFile(res, file, headers = {}) { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; } const ext = path.extname(file).toLowerCase(); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }; res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', ...headers }); fs.createReadStream(file).pipe(res); }

async function handlePayments(req, res, url, pathname) {
  if (req.method === 'POST' && pathname === '/api/payments/demo') {
    if (!demoCheckoutEnabled(req)) { send(res, 404, { error: 'Demo checkout is available only on a local non-production server.' }); return true; }
    const b = await body(req, 10000), order = store.orders.find(o => o.id === cleanString(b.orderId, 80)), token = cleanString(b.checkoutToken, 100);
    if (!order || !order.checkoutToken || token.length !== order.checkoutToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.checkoutToken))) { send(res, 403, { error: 'Checkout session is invalid. Please return to your order details.' }); return true; }
    if (order.status !== 'payment_pending') { send(res, 409, { error: 'This order is no longer awaiting payment.' }); return true; }
    const at = new Date().toISOString(); order.demoCheckoutCompletedAt = at; order.paymentEvidence = { ...(order.paymentEvidence || {}), provider: 'demo', status: 'demo_only' };
    order.events ||= []; order.events.push({ at, type: 'demo_checkout_completed', provider: 'demo', ipAddress: clientIp(req), note: 'No payment was submitted or charged.' });
    log('payment.demo_checkout_completed', { orderId: order.orderNumber, charged: false }, req); return send(res, 200, { demoCompleted: true });
  }
  if (req.method === 'POST' && pathname === '/api/payments/create') {
    const b = await body(req, 10000), order = store.orders.find(o => o.id === cleanString(b.orderId, 80)), provider = cleanString(b.provider, 30), gateway = gatewaySnapshot().find(x => x.id === provider);
    if (!order) { send(res, 404, { error: 'Order not found. Please return to your order details.' }); return true; }
    const checkoutToken = cleanString(b.checkoutToken, 100); if (!order.checkoutToken || checkoutToken.length !== order.checkoutToken.length || !crypto.timingSafeEqual(Buffer.from(checkoutToken), Buffer.from(order.checkoutToken))) { send(res, 403, { error: 'Checkout session is invalid. Please return to your order details.' }); return true; }
    if (!gateway?.enabled) { send(res, 400, { error: 'That payment method is not configured. Choose an enabled method or contact support.' }); return true; }
    if (order.status !== 'payment_pending') { send(res, 409, { error: 'This order is no longer awaiting payment.' }); return true; }
    if (['checkout_creating','checkout_created'].includes(order.paymentEvidence?.status)) { send(res, 409, { error: 'A payment checkout is already in progress for this order.' }); return true; }
    const base = (process.env.APP_BASE_URL || `http://${req.headers.host || 'localhost'}`).replace(/\/$/, ''), amount = Number(order.amount || 0).toFixed(2), currency = validCurrency(order.currency || store.settings.currency || 'USD');
    const mode = gateway.mode, config = gatewayConfig(provider,mode); order.paymentProvider = provider; order.paymentMode = mode;
    order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, mode, status: 'checkout_creating' }; writeStore(store);
    try {
      let result;
      if (provider === 'stripe') {
        if (currency !== 'EUR' || !isNetherlands(order.country)) throw new Error('Stripe iDEAL checkout requires a Netherlands order charged in EUR.');
        const form = new URLSearchParams({ mode: 'payment', success_url: `${base}/payment/stripe/return?orderId=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/payment/cancelled?orderId=${encodeURIComponent(order.id)}`, client_reference_id: order.id, customer_email: order.email, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': currency.toLowerCase(), 'line_items[0][price_data][unit_amount]': String(Math.round(Number(order.amount) * 100)), 'line_items[0][price_data][product_data][name]': order.packageName, 'metadata[orderId]': order.id });
        form.append('payment_method_types[]', 'ideal');
        result = await stripeJsonWithRetry('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `checkout-${order.id}` }, body: form.toString() });
        order.stripeSessionId = result.id; if (order.status !== 'paid') order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, status: 'checkout_created' }; writeStore(store); send(res, 200, { provider, redirectUrl: result.url }); return true;
      }
      if (provider === 'paypal') {
        const { base: paypalBase, token } = await paypalAccessToken(mode);
        result = await providerJson(`${paypalBase}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `create-${order.id}` }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: order.orderNumber, custom_id: order.id, invoice_id: order.orderNumber.slice(0, 127), description: order.packageName, amount: { currency_code: currency, value: amount } }], application_context: { brand_name: 'VINtrue', user_action: 'PAY_NOW', return_url: `${base}/payment/paypal/return?orderId=${encodeURIComponent(order.id)}`, cancel_url: `${base}/payment/cancelled?orderId=${encodeURIComponent(order.id)}` } }) });
        order.paypalOrderId = result.id; if (order.status !== 'paid') order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, status: 'checkout_created' }; writeStore(store);
        const approve = result.links?.find(x => ['approve','payer-action'].includes(x.rel))?.href; if (!approve) throw new Error('PayPal did not return an approval link.'); send(res, 200, { provider, redirectUrl: approve }); return true;
      }
      if (provider === 'authorize_net') {
        const returnUrl = `${base}/payment/anet/return?orderId=${encodeURIComponent(order.id)}`, invoiceNumber = `${order.orderNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}${crypto.randomBytes(6).toString('hex')}`; order.anetInvoiceNumber = invoiceNumber; writeStore(store);
        result = await anetRequest('getHostedPaymentPageRequest', { merchantAuthentication: { name: config.loginId, transactionKey: config.transactionKey }, transactionRequest: { transactionType: 'authCaptureTransaction', amount, currencyCode: currency, order: { invoiceNumber, description: order.packageName }, customer: { email: order.email } }, hostedPaymentSettings: { setting: [{ settingName: 'hostedPaymentReturnOptions', settingValue: JSON.stringify({ showReceipt: true, url: returnUrl, urlText: 'Return to report order', cancelUrl: `${base}/payment/cancelled?orderId=${encodeURIComponent(order.id)}`, cancelUrlText: 'Cancel payment' }) }, { settingName: 'hostedPaymentPaymentOptions', settingValue: JSON.stringify({ cardCodeRequired: true, showCreditCard: true, showBankAccount: false }) }, { settingName: 'hostedPaymentCustomerOptions', settingValue: JSON.stringify({ showEmail: true, requiredEmail: true }) }, { settingName: 'hostedPaymentOrderOptions', settingValue: JSON.stringify({ show: true, merchantName: 'VINtrue' }) }] } }, mode);
        if (!result.token) throw new Error('Authorize.Net did not return a hosted checkout token.'); if (order.status !== 'paid') order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, status: 'checkout_created' }; writeStore(store);
        send(res, 200, { provider, formToken: result.token, formUrl: mode === 'live' ? 'https://accept.authorize.net/payment/payment' : 'https://test.authorize.net/payment/payment' }); return true;
      }
      if (provider === 'mollie') {
        const paymentRequest = { amount: { currency, value: amount }, description: `${order.packageName} · ${order.orderNumber}`, redirectUrl: `${base}/payment/mollie/return?orderId=${encodeURIComponent(order.id)}`, cancelUrl: `${base}/payment/cancelled?orderId=${encodeURIComponent(order.id)}`, metadata: { orderId: order.id, orderNumber: order.orderNumber } };
        if (publicHttpsBase()) paymentRequest.webhookUrl = `${base}/api/webhooks/mollie`;
        result = await providerJson('https://api.mollie.com/v2/payments', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `vintrue-${order.id}` }, body: JSON.stringify(paymentRequest) });
        const checkoutUrl = result._links?.checkout?.href;
        if (!result.id || !checkoutUrl) throw new Error('Mollie did not return a hosted checkout link.');
        order.molliePaymentId = result.id; order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, status: 'checkout_created', molliePaymentId: result.id, checkoutUrl }; writeStore(store);
        send(res, 200, { provider, redirectUrl: checkoutUrl }); return true;
      }
      send(res, 400, { error: 'Unsupported payment provider.' }); return true;
    } catch (error) { order.paymentEvidence = { ...(order.paymentEvidence || {}), provider, status: 'checkout_failed' }; writeStore(store); log('payment.checkout_failed', { orderId: order.orderNumber || order.id, provider, error: cleanString(error.message, 240) }, req); send(res, 502, { error: `Could not start ${gateway.name} checkout. ${cleanString(error.message, 200)}` }); return true; }
  }
  if (req.method === 'POST' && pathname === '/api/webhooks/mollie') {
    const raw = await rawBody(req, 10000), params = new URLSearchParams(raw.toString('utf8')), paymentId = cleanString(params.get('id'), 100);
    const order = store.orders.find(item => item.molliePaymentId === paymentId);
    if (!/^tr_[A-Za-z0-9]+$/.test(paymentId) || !order || !gatewayConfig('mollie',order.paymentMode||gatewayMode('mollie')).apiKey) { send(res, 400, { error: 'Invalid Mollie payment notification.' }); return true; }
    try { const payment = await molliePayment(paymentId); if (reconcileMolliePayment(payment)) log('payment.mollie_status_updated', { paymentId, status: payment.status }); send(res, 200, { received: true }); }
    catch (error) { log('payment.mollie_webhook_failed', { paymentId, error: cleanString(error.message, 200) }, req); send(res, 502, { error: 'Could not verify the Mollie payment notification.' }); }
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/webhooks/stripe') {
    const raw = await rawBody(req, 1024 * 1024), header = String(req.headers['stripe-signature'] || ''), parts = Object.fromEntries(header.split(',').map(x => x.split('=').map(y => y.trim()))), timestamp = Number(parts.t);
    let mode = '';
    if (timestamp && Math.abs(Date.now() / 1000 - timestamp) <= 300) for (const candidate of gatewayModes.stripe) { const secret = gatewayConfig('stripe',candidate).webhookSecret; if (!secret) continue; const expected = crypto.createHmac('sha256',secret).update(`${parts.t}.${raw}`).digest('hex'); if (header.split(',').some(x => x.trim().startsWith('v1=') && timingSafeHex(expected,x.trim().slice(3)))) { mode = candidate; break; } }
    if (!mode) { send(res, 400, { error: 'Invalid Stripe webhook signature.' }); return true; }
    let event; try { event = JSON.parse(raw.toString('utf8')); } catch { send(res, 400, { error: 'Invalid webhook body.' }); return true; }
    if (['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && event.data?.object?.payment_status === 'paid') {
      const session = event.data.object, order = store.orders.find(o => o.id === (session.client_reference_id || session.metadata?.orderId) && o.paymentMode === mode && (!o.stripeSessionId || o.stripeSessionId === session.id));
      if (order && !(order.gatewayEventIds || []).includes(event.id)) { let details={paymentIntentId:session.payment_intent||''}; try { details=await stripeEvidence(session.payment_intent,mode); } catch {} applyPaymentSuccess(order,'stripe',session.payment_intent||session.id,details); order.gatewayEventIds ||= []; if(!order.gatewayEventIds.includes(event.id))order.gatewayEventIds.push(event.id); writeStore(store); }
    }
    if (['charge.refunded','charge.dispute.created'].includes(event.type)) {
      const charge = event.data?.object || {}, order = store.orders.find(o => o.paymentMode === mode && (o.paymentEvidence?.paymentIntentId === charge.payment_intent || o.paymentEvidence?.transactionId === charge.charge));
      if (order && !(order.gatewayEventIds || []).includes(event.id)) {
        if (event.type === 'charge.refunded') applyPaymentRefund(order,'stripe',charge.id,Number(charge.amount_refunded||0)/100,event.id);
        else { applyPaymentLoss(order,'chargeback','stripe',charge.charge||order.paymentEvidence?.transactionId||charge.id,event.id); const now=new Date().toISOString(); order.disputeCase={...(order.disputeCase||{}),stripeDisputeId:charge.id||'',reason:cleanString(charge.reason,120),status:cleanString(charge.status,60),dueBy:charge.evidence_details?.due_by?new Date(charge.evidence_details.due_by*1000).toISOString():'',amount:Number(charge.amount||0)/100,currency:String(charge.currency||order.currency||'USD').toUpperCase(),createdAt:charge.created?new Date(charge.created*1000).toISOString():now,evidenceDraft:order.disputeCase?.evidenceDraft||{}}; }
        order.gatewayEventIds ||= []; if(!order.gatewayEventIds.includes(event.id))order.gatewayEventIds.push(event.id); writeStore(store);
      }
    }
    send(res, 200, { received: true }); return true;
  }
  if (req.method === 'POST' && pathname === '/api/webhooks/paypal') {
    const raw = await rawBody(req, 1024 * 1024); let event; try { event = JSON.parse(raw.toString('utf8')); } catch { send(res, 400, { error: 'Invalid webhook body.' }); return true; }
    const resource = event.resource || {}, relatedOrderId = resource.custom_id || resource.supplementary_data?.related_ids?.order_id || resource.disputed_transactions?.[0]?.seller_transaction_id || '', paypalOrder = store.orders.find(o => o.id === relatedOrderId || (o.paypalOrderId && o.paypalOrderId === relatedOrderId) || o.paymentEvidence?.transactionId === relatedOrderId), mode = paypalOrder?.paymentMode || gatewayMode('paypal');
    try { const { base: paypalBase, token } = await paypalAccessToken(mode), h = req.headers, verified = await providerJson(`${paypalBase}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_algo: h['paypal-auth-algo'], cert_url: h['paypal-cert-url'], transmission_id: h['paypal-transmission-id'], transmission_sig: h['paypal-transmission-sig'], transmission_time: h['paypal-transmission-time'], webhook_id: gatewayConfig('paypal',mode).webhookId, webhook_event: event }) });
      if (verified.verification_status !== 'SUCCESS') { send(res, 400, { error: 'Invalid PayPal webhook signature.' }); return true; }
      let changed = false;
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') { const capture = event.resource || {}, paypalOrderId = capture.supplementary_data?.related_ids?.order_id, order = store.orders.find(o => o.paymentMode === mode && (o.id === capture.custom_id || (o.paypalOrderId && o.paypalOrderId === paypalOrderId))); if (order && !(order.gatewayEventIds || []).includes(event.id)) { applyPaymentSuccess(order,'paypal',capture.id); order.gatewayEventIds ||= []; if(!order.gatewayEventIds.includes(event.id))order.gatewayEventIds.push(event.id); changed = true; } }
      if (['PAYMENT.CAPTURE.REFUNDED','CUSTOMER.DISPUTE.CREATED'].includes(event.event_type)) { const resource = event.resource || {}, captureId = resource.id || resource.disputed_transactions?.[0]?.seller_transaction_id, order = store.orders.find(o => o.paymentMode === mode && (o.paymentEvidence?.transactionId === captureId || o.paypalOrderId === resource.supplementary_data?.related_ids?.order_id)); if (order && !(order.gatewayEventIds || []).includes(event.id)) { if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') applyPaymentRefund(order,'paypal',captureId,Number(resource.amount?.value||0),event.id); else applyPaymentLoss(order,'chargeback','paypal',captureId,event.id); order.gatewayEventIds ||= []; if(!order.gatewayEventIds.includes(event.id))order.gatewayEventIds.push(event.id); changed = true; } }
      if (changed) writeStore(store);
      send(res, 200, { received: true }); return true;
    } catch (error) { console.error('PayPal webhook verification failed:', error.message); send(res, 400, { error: 'PayPal webhook verification failed.' }); return true; }
  }
  if (req.method === 'POST' && pathname === '/api/webhooks/authorize-net') {
    const raw = await rawBody(req, 1024 * 1024); let event; try { event = JSON.parse(raw.toString('utf8')); } catch { send(res, 400, { error: 'Invalid webhook body.' }); return true; }
    const tx = event.payload || {}, order = store.orders.find(o => o.anetInvoiceNumber === tx.invoiceNumber || o.paymentEvidence?.transactionId === String(tx.id || '')), mode = order?.paymentMode || gatewayMode('authorize_net'), key = gatewayConfig('authorize_net',mode).signatureKey || '', signature = String(req.headers['x-anet-signature'] || '').replace(/^sha512=/i, '').toLowerCase(), digest = crypto.createHmac('sha512', Buffer.from(key, 'hex')).update(raw).digest('hex');
    if (!/^[a-f0-9]{128}$/i.test(key) || !timingSafeHex(digest, signature)) { send(res, 400, { error: 'Invalid Authorize.Net webhook signature.' }); return true; }
    if (order && !(order.gatewayEventIds || []).includes(event.notificationId)) {
      if (['net.authorize.payment.authcapture.created','net.authorize.payment.fraud.approved'].includes(event.eventType) && String(tx.responseCode) === '1') {
        applyPaymentSuccess(order, 'authorize_net', String(tx.transId || tx.id || ''), { cardLast4: String(tx.accountNumber || '').slice(-4), cardBrand: tx.accountType || '', avsResult: tx.avsResponse || '', cvvResult: tx.cvvResponse || '' });
      } else if (event.eventType === 'net.authorize.payment.refund.created') {
        applyPaymentRefund(order, 'authorize_net', String(tx.id || ''), Number(tx.authAmount || 0), event.notificationId);
      } else if (event.eventType === 'net.authorize.payment.fraud.held') {
        order.paymentEvidence = { ...(order.paymentEvidence || {}), provider: 'authorize_net', status: 'fraud_review' }; order.events.push({ at: new Date().toISOString(), type: 'payment_fraud_review', provider: 'authorize_net', transactionId: String(tx.id || ''), ipAddress: 'payment_provider' }); log('payment.fraud_review', { orderId: order.orderNumber, provider: 'authorize_net' });
      } else if (event.eventType === 'net.authorize.payment.fraud.declined') {
        order.paymentEvidence = { ...(order.paymentEvidence || {}), provider: 'authorize_net', status: 'declined' }; order.events.push({ at: new Date().toISOString(), type: 'payment_declined', provider: 'authorize_net', transactionId: String(tx.id || ''), ipAddress: 'payment_provider' }); log('payment.declined', { orderId: order.orderNumber, provider: 'authorize_net' });
      }
      order.gatewayEventIds ||= []; if(!order.gatewayEventIds.includes(event.notificationId))order.gatewayEventIds.push(event.notificationId); writeStore(store);
    }
    send(res, 200, { received: true }); return true;
  }
  if (req.method === 'GET' && pathname === '/payment/stripe/return') {
    const orderId = cleanString(url.searchParams.get('orderId'), 80), sessionId = cleanString(url.searchParams.get('session_id'), 120), order = store.orders.find(o => o.id === orderId);
    if (order && sessionId && sessionId === order.stripeSessionId) { try { const mode = order.paymentMode || gatewayMode('stripe'), session = await providerJson(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${gatewayConfig('stripe',mode).secretKey}` } }); if (session.client_reference_id === order.id && session.payment_status === 'paid' && Boolean(session.livemode) === (mode === 'live')) { let details={paymentIntentId:session.payment_intent||''};try{details=await stripeEvidence(session.payment_intent,mode)}catch{}applyPaymentSuccess(order, 'stripe', session.payment_intent || session.id, details); writeStore(store); } } catch (error) { log('payment.stripe_return_check_failed',{orderId:order.orderNumber||order.id,error:cleanString(error.message,200)},req); } }
    redirectThankYou(res, order); return true;
  }
  if (req.method === 'GET' && pathname === '/payment/paypal/return') {
    const orderId = cleanString(url.searchParams.get('orderId'), 80), paypalOrderId = cleanString(url.searchParams.get('token'), 120), order = store.orders.find(o => o.id === orderId && o.paypalOrderId === paypalOrderId);
    if (order) { try { const { base: paypalBase, token } = await paypalAccessToken(order.paymentMode||gatewayMode('paypal')), result = await providerJson(`${paypalBase}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `capture-${order.id}` }, body: '{}' }); const capture = result.purchase_units?.[0]?.payments?.captures?.[0]; if (result.status === 'COMPLETED' && capture?.id) { applyPaymentSuccess(order, 'paypal', capture.id); writeStore(store); } } catch (error) { console.error('PayPal capture failed:', error.message); log('payment.paypal_capture_failed',{orderId:order.orderNumber||order.id,error:cleanString(error.message,200)},req); } }
    redirectThankYou(res, order); return true;
  }
  if (req.method === 'GET' && pathname === '/payment/anet/return') { const order = store.orders.find(o => o.id === cleanString(url.searchParams.get('orderId'), 80)); redirectThankYou(res, order); return true; }
  if (req.method === 'GET' && pathname === '/payment/mollie/return') {
    const order = store.orders.find(o => o.id === cleanString(url.searchParams.get('orderId'), 80) && o.molliePaymentId);
    if (order) { try { reconcileMolliePayment(await molliePayment(order.molliePaymentId)); } catch (error) { log('payment.mollie_return_check_failed', { orderId: order.orderNumber || order.id, error: cleanString(error.message, 200) }, req); } }
    redirectThankYou(res, order); return true;
  }
  if (req.method === 'GET' && pathname === '/payment/cancelled') { const orderId = cleanString(url.searchParams.get('orderId'), 80), order = store.orders.find(o => o.id === orderId); if (order && !['paid','complete'].includes(order.status)) { order.paymentEvidence = { ...(order.paymentEvidence || {}), status: 'checkout_cancelled' }; if (Array.isArray(order.events)) order.events.push({ at: new Date().toISOString(), type: 'payment_checkout_cancelled', provider: order.paymentEvidence.provider || '', ipAddress: clientIp(req) }); writeStore(store); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(paymentResultPage('Checkout cancelled', 'No successful payment confirmation was received. Return to the site and try checkout again.')); return true; }
  return false;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`), pathname = decodeURIComponent(url.pathname);
  if (await handlePayments(req, res, url, pathname)) return;
  if (req.method === 'GET' && pathname === '/api/public/settings') return send(res, 200, { ...store.settings, paymentProviders: gatewaySnapshot(), demoCheckout: demoCheckoutEnabled(req) });
  if (req.method === 'GET' && pathname.startsWith('/api/public/orders/')) {
    const id = decodeURIComponent(pathname.slice('/api/public/orders/'.length)), order = store.orders.find(item => item.id === id), token = cleanString(url.searchParams.get('token'), 100);
    if (!order || !order.checkoutToken || token.length !== order.checkoutToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.checkoutToken))) return send(res, 404, { error: 'Order details are unavailable.' });
    return send(res, 200, { orderNumber: order.orderNumber, fullName: order.fullName, createdAt: order.createdAt, vehicleType: order.vehicleType, vehicle: order.vehicle, status: order.status, packageName: order.packageName, demoCompleted: Boolean(order.demoCheckoutCompletedAt) });
  }
  if (req.method === 'GET' && pathname.startsWith('/report/')) {
    const token = pathname.slice('/report/'.length);
    if (!store.orders.some(o => o.reportToken && o.reportToken === token && o.reportFile)) { res.writeHead(404); return res.end('Report not found or link expired.'); }
    res.writeHead(302, { Location: `/portal/${encodeURIComponent(token)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end();
  }
  if (req.method === 'GET' && /^\/portal\/[A-Za-z0-9_-]+\/download$/.test(pathname)) {
    const token = pathname.split('/')[2], order = store.orders.find(o => o.reportToken === token && o.reportFile), session = portalSessionFor(req, token);
    if (!order || !session) { res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end('Verify the email address on the order to access this report.'); }
    const reportPath = path.join(REPORT_DIR, path.basename(order.reportFile)); if (!reportPath.startsWith(REPORT_DIR) || !fs.existsSync(reportPath)) { res.writeHead(404); return res.end('Report is unavailable.'); }
    const facts = clientFacts(req), at = new Date().toISOString(), bytesExpected = fs.statSync(reportPath).size, stream = fs.createReadStream(reportPath); let bytesSent = 0, completed = false;
    if (!Array.isArray(order.events)) order.events = []; order.events.push({ at, type: 'report_download_requested', ipAddress: facts.ipAddress, browser: facts.browser, device: facts.device, platform: facts.platform, accessType: accessClassification(req), authMethod: 'email_otp' }); writeStore(store);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="vehicle-report-${order.orderNumber || order.id}.pdf"`, 'Content-Length': bytesExpected, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    stream.on('data', chunk => { bytesSent += chunk.length; }); stream.on('error', error => { if (!res.headersSent) res.writeHead(500); res.destroy(error); });
    res.on('finish', () => { completed = true; const finishedAt = new Date().toISOString(), download = { at, completedAt: finishedAt, ipAddress: facts.ipAddress, browser: facts.browser, device: facts.device, platform: facts.platform, accessType: accessClassification(req), authMethod: 'email_otp', statusCode: res.statusCode, bytesSent, bytesExpected }; if (!Array.isArray(order.downloadEvents)) order.downloadEvents = []; order.downloadEvents.push(download); order.events.push({ at: finishedAt, type: 'report_download_completed', ...download }); log('report.download_completed', { orderId: order.orderNumber || order.id, accessType: download.accessType, authMethod: 'email_otp', bytesSent, downloadCount: order.downloadEvents.length }, req); });
    res.on('close', () => { if (completed) return; const closedAt = new Date().toISOString(); order.events.push({ at: closedAt, type: 'report_download_interrupted', ipAddress: facts.ipAddress, accessType: accessClassification(req), authMethod: 'email_otp', bytesSent, bytesExpected }); log('report.download_interrupted', { orderId: order.orderNumber || order.id, authMethod: 'email_otp', bytesSent, bytesExpected }, req); });
    return stream.pipe(res);
  }
  if (req.method === 'POST' && pathname === '/api/portal/request-code') {
    const b = await body(req, 10000), token = cleanString(b.token, 100), email = cleanString(b.email, 160).toLowerCase(), ip = clientIp(req), challengeId = crypto.randomBytes(24).toString('base64url'), generic = { message: 'If this email matches the order, a verification code has been sent.', challengeId };
    if (portalRateLimited(`ip:${ip}`, 12) || portalRateLimited(`email:${email}`, 5)) return send(res, 200, generic);
    const order = store.orders.find(o => o.reportToken === token && o.reportFile), matches = order && email && email === String(order.email || '').trim().toLowerCase();
    if (!matches) { if (order) portalEvent(order, 'portal_code_request_rejected', req, { reason: 'email_mismatch' }); return send(res, 200, generic); }
    const key = `order:${order.id}`; if (portalRateLimited(key, 5, 15 * 60 * 1000)) { portalEvent(order, 'portal_code_request_throttled', req); return send(res, 200, generic); }
    const salt = crypto.randomBytes(16).toString('hex'), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expiresAt = Date.now() + PORTAL_CODE_MS;
    for (const [id, challenge] of portalChallenges) if (challenge.orderId === order.id) portalChallenges.delete(id);
    try {
      const testMode = localPortalTestMode(req) && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM);
      const messageId = testMode ? 'local-test-mode' : await sendEmail(order.email, 'Your secure vehicle report access code', `Your one-time access code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`, `<p>Your one-time access code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`);
      portalChallenges.set(challengeId, { orderId: order.id, token, salt, codeHash: crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex'), expiresAt, attempts: 0 });
      portalEvent(order, testMode ? 'portal_test_code_issued' : 'portal_code_sent', req, { destination: order.email, expiresAt: new Date(expiresAt).toISOString(), providerMessageId: messageId, testMode }); log(testMode ? 'portal.test_code_issued' : 'portal.code_sent', { orderId: order.orderNumber || order.id, providerMessageId: messageId }, req);
      return send(res, 200, testMode ? { ...generic, testCode: code } : generic);
    } catch (error) { portalEvent(order, 'portal_code_delivery_failed', req, { providerError: cleanString(error.message, 240) }); log('portal.code_delivery_failed', { orderId: order.orderNumber || order.id, error: cleanString(error.message, 240) }, req); return send(res, 200, generic); }
  }
  if (req.method === 'POST' && pathname === '/api/portal/verify-code') {
    const b = await body(req, 10000), id = cleanString(b.challengeId, 80), code = cleanString(b.code, 12), token = cleanString(b.token, 100), challenge = portalChallenges.get(id), ip = clientIp(req);
    if (portalRateLimited(`verify:${ip}`, 30) || !challenge || challenge.token !== token || challenge.expiresAt < Date.now() || challenge.attempts >= 5) { if (challenge) portalChallenges.delete(id); return send(res, 400, { error: 'The code is invalid or expired. Request a new code and try again.' }); }
    challenge.attempts++; const candidate = crypto.createHash('sha256').update(`${challenge.salt}:${code}`).digest('hex'), valid = /^[0-9]{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(challenge.codeHash, 'hex'));
    const order = store.orders.find(o => o.id === challenge.orderId && o.reportToken === token && o.reportFile);
    if (!order) { portalChallenges.delete(id); return send(res, 400, { error: 'The code is invalid or expired. Request a new code and try again.' }); }
    if (!valid) { portalEvent(order, 'portal_code_verification_failed', req, { attempt: challenge.attempts }); if (challenge.attempts >= 5) portalChallenges.delete(id); return send(res, 400, { error: 'The code is invalid or expired. Request a new code and try again.' }); }
    portalChallenges.delete(id); const sid = crypto.randomBytes(32).toString('base64url'), expires = Date.now() + PORTAL_SESSION_MS; portalSessions.set(sid, { orderId: order.id, token, expires }); const event = portalEvent(order, 'portal_email_verified', req, { sessionExpiresAt: new Date(expires).toISOString(), challengeId: id.slice(0, 8) }); log('portal.email_verified', { orderId: order.orderNumber || order.id, sessionExpiresAt: new Date(expires).toISOString() }, req);
    return send(res, 200, { ok: true, expiresAt: new Date(expires).toISOString() }, { 'Set-Cookie': `${PORTAL_COOKIE}=${sid}; ${portalCookieOptions(Math.floor(PORTAL_SESSION_MS / 1000))}` });
  }
  if (req.method === 'GET' && /^\/portal\/[A-Za-z0-9_-]+$/.test(pathname)) return staticFile(res, path.join(ROOT, 'portal.html'), { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });  if (req.method === 'POST' && pathname === '/api/orders') {
    const b = await body(req, 20000), p = store.settings.packages.find(x => x.id === b.packageId);
    if (!p) return send(res, 400, { error: 'Please select an available package.' });
    const name = cleanString(b.fullName, 120), email = cleanString(b.email, 160), phone = cleanString(b.phone, 60), vehicle = cleanString(b.vehicle, 40), type = b.vehicleType === 'License plate' ? 'License plate' : 'VIN', country = (store.settings.countries || ['Netherlands']).includes(cleanString(b.country, 80)) ? cleanString(b.country, 80) : '';
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !phone || !vehicle || !country || b.accepted !== true) return send(res, 400, { error: 'Please complete all required fields and accept the order terms.' });
    if (type === 'VIN' && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicle)) return send(res, 400, { error: 'Please enter a valid 17-character VIN.' });
    const currency = validCurrency(store.settings.currency || 'USD'); let pricing; try { pricing = VehiclePricing.calculate({ packages: store.settings.packages, packageId: p.id, windowStickerSelected: b.windowStickerSelected !== false, pricingRules: store.settings.pricingRules || {}, currency }); } catch (error) { return send(res, 400, { error: error.message || 'Unable to calculate order pricing.' }); }
    const createdAt = new Date().toISOString(), facts = clientFacts(req), day = createdAt.slice(0, 10), sequence = (Number(store.orderDailyCounts?.[day]) || 0) + 1;
    if (b.location && typeof b.location === 'object') {
      const latitude = Number(b.location.latitude), longitude = Number(b.location.longitude), accuracyMeters = Number(b.location.accuracyMeters);
      if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(accuracyMeters) && accuracyMeters >= 0 && accuracyMeters <= 100000) facts.location = { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6, accuracyMeters: Math.round(accuracyMeters), capturedAt: createdAt };
    }
    store.orderDailyCounts ||= {}; store.orderDailyCounts[day] = sequence;
    const orderId = makeOrderNumber(store.orderPrefix || 'AVR', name, day, sequence), packageSnapshot = { id: p.id, name: p.name, price: Number(p.price), currency, tag: p.tag || '', description: p.description || '', features: [...(p.features || [])] };
    const customerLanguage = b.language === 'en' ? 'en' : 'nl'; const submittedPolicyDocs = b.policyDocuments && typeof b.policyDocuments === 'object' && !Array.isArray(b.policyDocuments) ? b.policyDocuments : {}; const consentSnapshot = { version: TERMS_VERSION + '-' + customerLanguage, language: customerLanguage, acceptedAt: createdAt, copy: customerLanguage === 'nl' ? TERMS_SNAPSHOT_NL : TERMS_SNAPSHOT, policyLanguage: customerLanguage, policyDocuments: Object.fromEntries(['terms','privacy','refund','cancellation'].map(key => [key, typeof submittedPolicyDocs[key] === 'string' ? submittedPolicyDocs[key].slice(0, 20000) : (store.settings.policyPages?.[key] || defaultPolicyPages[key])])) };
    const order = { id: crypto.randomUUID(), pricingSnapshot: pricing, checkoutToken: crypto.randomBytes(32).toString('base64url'), orderNumber: orderId, createdAt, completedAt: null, reportSentAt: null, fullName: name, email, phone, vehicleType: type, vehicle, country, packageId: p.id, packageName: p.name, amount: Number(pricing.totalAmount), currency, packageSnapshot, status: 'payment_pending', agentName: '', internalNote: '', consentAccepted: true, consentAt: createdAt, consentSnapshot, client: facts, paymentEvidence: { provider: '', transactionId: '', paymentIntentId: '', status: '', authorizedAt: '', threeDSecure: '', avsResult: '', cvvResult: '', cardBrand: '', cardLast4: '' }, reportEvidence: { sha256: '', sizeBytes: 0, uploadedBy: '', sentTo: email, deliveryChannel: '' }, reportToken: '', reportFile: '', downloadEvents: [], events: [{ at: createdAt, type: 'order_created', ipAddress: facts.ipAddress, browser: facts.browser, device: facts.device, platform: facts.platform }, { at: createdAt, type: 'consent_accepted', termsVersion: consentSnapshot.version, consent: consentSnapshot.copy, ipAddress: facts.ipAddress }] };
    store.orders.unshift(order); store.logs.unshift({ id: crypto.randomUUID(), at: createdAt, action: 'order.created', detail: { orderId: order.orderNumber, packageName: p.name, amount: Number(pricing.totalAmount), pricingSnapshot: pricing, currency, status: order.status, consentLanguage: customerLanguage, termsVersion: consentSnapshot.version }, ip: facts.ipAddress }); store.logs = store.logs.slice(0, 2000); writeStore(store);
    return send(res, 201, { id: order.id, checkoutToken: order.checkoutToken, orderId: order.orderNumber, status: order.status });
  }
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown'; if (loginBlocked(ip)) return send(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
    const b = await body(req, 10000), email = cleanString(b.email, 160).toLowerCase(), password = typeof b.password === 'string' ? b.password : '';
    if (email !== ADMIN_EMAIL || !safeEqual(password)) { const previous = loginAttempts.get(ip), count = (previous?.count || 0) + 1; loginAttempts.set(ip, { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : Date.now() + 15 * 60 * 1000 }); log('admin.login_failed', {}, req); return send(res, 401, { error: count >= 5 ? 'Too many sign-in attempts. Wait 15 minutes and try again.' : 'Email or password is incorrect.' }); }
    loginAttempts.delete(ip); const sid = crypto.randomBytes(32).toString('base64url'), session = { csrf: crypto.randomBytes(32).toString('base64url'), expires: Date.now() + SESSION_MS }; sessions.set(sid, session); log('admin.login', { email: ADMIN_EMAIL }, req); return send(res, 200, { email: ADMIN_EMAIL, csrf: session.csrf }, { 'Set-Cookie': `${COOKIE}=${sid}; ${cookieOptions()}` });
  }
  if (req.method === 'POST' && pathname === '/api/admin/logout') { const s = authorized(req, res); if (!s) return; const sid = parseCookies(req)[COOKIE]; sessions.delete(sid); log('admin.logout', { email: ADMIN_EMAIL }, req); return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` }); }
  if (pathname.startsWith('/api/admin/')) {
    const session = authorized(req, res); if (!session) return;
    if (req.method === 'GET' && pathname === '/api/admin/session') return send(res, 200, { email: ADMIN_EMAIL, csrf: session.csrf });
    if (req.method === 'PUT' && pathname === '/api/admin/password') {
      const b = await body(req, 10000), current = typeof b.currentPassword === 'string' ? b.currentPassword : '', next = typeof b.newPassword === 'string' ? b.newPassword : '', confirm = typeof b.confirmPassword === 'string' ? b.confirmPassword : '';
      if (!safeEqual(current)) return send(res, 403, { error: 'Current password is incorrect.' });
      if (next.length < 14 || next.length > 200 || /[\r\n]/.test(next) || next.trim() !== next) return send(res, 400, { error: 'New password must be 14–200 characters with no leading, trailing, or line-break characters.' });
      if (next !== confirm) return send(res, 400, { error: 'New password and confirmation do not match.' });
      if (safeEqual(next)) return send(res, 400, { error: 'Choose a password different from your current password.' });
      persistAdminPassword(next); log('admin.password_changed', { email: ADMIN_EMAIL }, req); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/data') return send(res, 200, { settings: store.settings, orderCount: store.orders.length, logCount: store.logs.length, agents: store.agents || [], orderPrefix: store.orderPrefix || 'AVR', portalEmailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) });
    if (req.method === 'GET' && pathname === '/api/admin/reviews') return send(res, 200, { reviews: store.settings.reviews || [] });
    if (req.method === 'PUT' && pathname === '/api/admin/reviews') { try { store.settings.reviews = validReviews((await body(req, 300000)).reviews); log('website.reviews_updated', { reviewCount: store.settings.reviews.length }, req); writeStore(store); return send(res, 200, { reviews: store.settings.reviews }); } catch (error) { return send(res, error.status || 400, { error: error.message }); } }
    if (req.method === 'GET' && pathname === '/api/admin/gateways') return send(res, 200, { appBaseUrl: process.env.APP_BASE_URL || '', gateways: gatewaySnapshot(), webhookUrls: Object.fromEntries([['stripe','/api/webhooks/stripe'],['paypal','/api/webhooks/paypal'],['authorize_net','/api/webhooks/authorize-net'],['mollie','/api/webhooks/mollie']].map(([k,v])=>[k,`${(process.env.APP_BASE_URL||'https://your-domain.com').replace(/\/$/,'')}${v}`])) });
    if (req.method === 'PUT' && pathname === '/api/admin/gateways') {
      const b = await body(req, 20000), values = {};
      for (const [id,prefix,suffixes] of [['stripe','STRIPE',['PUBLIC_KEY','SECRET_KEY','WEBHOOK_SECRET']],['paypal','PAYPAL',['CLIENT_ID','CLIENT_SECRET','WEBHOOK_ID']],['authorize_net','ANET',['LOGIN_ID','TRANSACTION_KEY','SIGNATURE_KEY']],['mollie','MOLLIE',['API_KEY']]]) { const oldMode = gatewayMode(id); for (const suffix of suffixes) { const legacy = process.env[`${prefix}_${suffix}`], scopedKey = `${prefix}_${oldMode.toUpperCase()}_${suffix}`; if (legacy && !process.env[scopedKey]) values[scopedKey] = legacy; } }
      if (b.appBaseUrl !== undefined && cleanString(b.appBaseUrl, 300)) { const base = cleanString(b.appBaseUrl, 300).replace(/\/+$/, ''); let parsed; try { parsed = new URL(base); } catch { return send(res, 400, { error: 'Enter a valid public site URL for APP_BASE_URL.' }); } if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || (parsed.protocol === 'http:' && !['127.0.0.1','localhost','::1'].includes(parsed.hostname)) || parsed.pathname !== '/') return send(res, 400, { error: 'Use the HTTPS site origin (or localhost for testing), without a path.' }); values.APP_BASE_URL = base; }
      const groups = [
        ['stripe','STRIPE', ['PUBLIC_KEY','SECRET_KEY','WEBHOOK_SECRET'], 'test'],
        ['paypal','PAYPAL', ['CLIENT_ID','CLIENT_SECRET','WEBHOOK_ID'], 'test'],
        ['authorize_net','ANET', ['LOGIN_ID','TRANSACTION_KEY','SIGNATURE_KEY'], 'test'],
        ['mollie','MOLLIE', ['API_KEY'], 'test']
      ];
      for (const [id, prefix, keys, defaultMode] of groups) {
        const input = b[id] || {}, mode = ['test','live'].includes(input.mode) ? input.mode : defaultMode;
        values[`${prefix}_ENABLED`] = input.enabled === true ? 'true' : 'false'; values[`${prefix}_MODE`] = mode;
        for (const key of keys) { const value = cleanString(input[key.toLowerCase()] || '', 1000); if (value) values[`${prefix}_${mode.toUpperCase()}_${key}`] = value; }
        if (id === 'stripe') {
          const pub = cleanString(input.public_key || '', 1000), secret = cleanString(input.secret_key || '', 1000), modePrefix = mode === 'live' ? 'live' : 'test';
          if ((pub && !pub.startsWith(`pk_${modePrefix}_`)) || (secret && !secret.startsWith(`sk_${modePrefix}_`))) return send(res, 400, { error: `Stripe ${mode} mode needs matching pk_${modePrefix}_ and sk_${modePrefix}_ keys.` });
        }
        if (id === 'mollie') { const key = cleanString(input.api_key || '', 300); if (key && !(mode === 'test' ? key.startsWith('test_') : key.startsWith('live_'))) return send(res, 400, { error: `Select ${mode} mode and enter a matching ${mode}_ Mollie API key.` }); }
      }
      saveGatewayEnvironment(values); log('payment.gateways_updated', { gateways: gatewaySnapshot().map(x => ({ id: x.id, enabled: x.enabled, mode: x.mode, missing: x.missing })) }, req);
      return send(res, 200, { gateways: gatewaySnapshot() });
    }
    if (req.method === 'PUT' && pathname === '/api/admin/order-id-settings') {
      const b = await body(req, 10000), prefix = cleanString(b.prefix, 8).toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(prefix)) return send(res, 400, { error: 'Prefix must be 1–8 letters or numbers.' });
      store.orderPrefix = prefix; log('order_id.prefix_updated', { prefix }, req); return send(res, 200, { prefix });
    }
    if (req.method === 'PUT' && pathname === '/api/admin/agents') {
      const b = await body(req, 10000), names = Array.isArray(b.agents) ? b.agents.map(x => cleanString(x, 100)).filter(Boolean) : [];
      store.agents = [...new Set(names)].slice(0, 100); log('agents.updated', { count: store.agents.length }, req); return send(res, 200, { agents: store.agents });
    }
    if (req.method === 'GET' && pathname === '/api/admin/summary') {
      const from = cleanString(url.searchParams.get('from'), 10), to = cleanString(url.searchParams.get('to'), 10);
      const inRange = o => { const day = String(o.createdAt || '').slice(0, 10); return (!from || day >= from) && (!to || day <= to); };
      const losses = store.orders.filter(o => inRange(o) && (['refunded', 'chargeback'].includes(o.status) || Number(o.paymentEvidence?.refundedAmount||0)>0));
      const pending = store.orders.filter(o => ['payment_pending', 'paid', 'reporting'].includes(o.status));
      const fulfilled = store.orders.filter(o => ['delivered', 'complete'].includes(o.status));
      const revenueOrders = store.orders.filter(o => ['paid','reporting','delivered','complete'].includes(o.status)), revenueByCurrency = {}, lossByCurrency = {};
      for (const o of revenueOrders) { const c=String(o.currency||'USD').toUpperCase(); revenueByCurrency[c]=(revenueByCurrency[c]||0)+Math.max(0,Number(o.amount||0)-Number(o.paymentEvidence?.refundedAmount||0)); }
      for (const o of losses) { const c=String(o.currency||'USD').toUpperCase(); lossByCurrency[c]=(lossByCurrency[c]||0)+(o.status==='chargeback'?Number(o.amount||0):Number(o.paymentEvidence?.refundedAmount||o.amount||0)); }
      const revenue=Object.values(revenueByCurrency).reduce((a,b)=>a+b,0),lossAmount=Object.values(lossByCurrency).reduce((a,b)=>a+b,0);
      return send(res, 200, { pendingCount: pending.length, fulfilledCount: fulfilled.length, revenue, lossAmount, revenueByCurrency, lossByCurrency, chargebackCount: losses.filter(o => o.status === 'chargeback').length, refundCount: losses.filter(o => o.status === 'refunded' || Number(o.paymentEvidence?.refundedAmount||0)>0).length });
    }
    if (req.method === 'GET' && pathname === '/api/admin/evidence') {
      const q = { from: cleanString(url.searchParams.get('from'), 10), to: cleanString(url.searchParams.get('to'), 10), name: cleanString(url.searchParams.get('name'), 120).toLowerCase(), phone: cleanString(url.searchParams.get('phone'), 60).toLowerCase(), vin: cleanString(url.searchParams.get('vin'), 40).toLowerCase() };
      const filtered = store.orders.filter(o => { const day = String(o.createdAt || '').slice(0, 10); return (!q.from || day >= q.from) && (!q.to || day <= q.to) && (!q.name || String(o.fullName || '').toLowerCase().includes(q.name)) && (!q.phone || String(o.phone || '').toLowerCase().includes(q.phone)) && (!q.vin || String(o.vehicle || '').toLowerCase().includes(q.vin)); });
      const orders = filtered.slice(0, 1000).map(o => ({ id: o.id, orderNumber: o.orderNumber || o.id, createdAt: o.createdAt, fullName: o.fullName, email: o.email, phone: o.phone, vehicleType: o.vehicleType, vehicle: o.vehicle, packageName: o.packageName, amount: o.amount, currency: o.currency || 'USD', status: o.status, reportUploadedAt: o.reportUploadedAt || '', reportSentAt: o.reportSentAt || '', downloadCount: (o.downloadEvents || []).filter(x => x.completedAt).length, latestDownloadAt: o.downloadEvents?.at(-1)?.completedAt || '', paymentStatus: o.paymentEvidence?.status || 'not_connected', evidence: evidenceChecklist(o) }));
      return send(res, 200, { orders, totals: { orders: filtered.length, paymentVerified: filtered.filter(o => evidenceChecklist(o).checks.find(c => c.key === 'payment')?.complete).length, reportsSent: filtered.filter(o => Boolean(o.reportSentAt)).length, completedDownloads: filtered.reduce((n, o) => n + (o.downloadEvents || []).filter(x => x.completedAt).length, 0), nonAutomatedDownloads: filtered.reduce((n, o) => n + evidenceChecklist(o).completedDownloads, 0), evidenceComplete: filtered.filter(o => evidenceChecklist(o).done === evidenceChecklist(o).total).length } });
    }
    if (req.method === 'GET' && pathname === '/api/admin/export') {
      const csvCell = v => { let value = String(v ?? ''); if (/^[\s]*[=+@-]/.test(value)) value = "'" + value; return '"' + value.replace(/"/g, '""') + '"'; };
      const columns = ['Order ID', 'Order Created (UTC)', 'Order Completed (UTC)', 'Report Sent (UTC)', 'Consent Accepted (Server Time, UTC)', 'Terms Version', 'Accepted Policy Snapshot', 'Customer Name', 'Email', 'Phone', 'Customer IP', 'Device', 'Platform', 'Browser', 'Location Latitude', 'Location Longitude', 'Location Accuracy (meters)', 'Location Captured (UTC)', 'Vehicle Type', 'VIN / License Plate', 'Package', 'Currency', 'Amount', 'Package Snapshot', 'Status', 'Assigned Agent', 'Payment Provider', 'Payment Transaction ID', 'Payment Intent ID', 'Payment Status', 'Payment Authorized (UTC)', '3D Secure Result', 'AVS Result', 'CVV Result', 'Card Brand', 'Card Last 4', 'Report Uploaded (UTC)', 'Report SHA-256', 'Report Bytes', 'Report Sent To', 'Delivery Channel', 'Delivery Status', 'Delivery Message ID', 'Completed Downloads', 'Download Event Timeline', 'Internal Note'];
      const q = { from: cleanString(url.searchParams.get('from'), 10), to: cleanString(url.searchParams.get('to'), 10), name: cleanString(url.searchParams.get('name'), 120).toLowerCase(), phone: cleanString(url.searchParams.get('phone'), 60).toLowerCase(), vin: cleanString(url.searchParams.get('vin'), 40).toLowerCase(), status: cleanString(url.searchParams.get('status'), 40) };
      const filtered = store.orders.filter(o => { const day = String(o.createdAt || '').slice(0, 10); return (!q.from || day >= q.from) && (!q.to || day <= q.to) && (!q.name || String(o.fullName || '').toLowerCase().includes(q.name)) && (!q.phone || String(o.phone || '').toLowerCase().includes(q.phone)) && (!q.vin || String(o.vehicle || '').toLowerCase().includes(q.vin)) && (!q.status || o.status === q.status || (q.status === 'delivered' && o.status === 'complete')); });
      const rows = filtered.map(o => [o.orderNumber || o.id, o.createdAt, o.completedAt || '', o.reportSentAt || '', o.consentAt || '', o.consentSnapshot?.version || '', JSON.stringify(o.consentSnapshot?.copy || {}), o.fullName, o.email, o.phone, o.client?.ipAddress || '', o.client?.device || '', o.client?.platform || '', o.client?.browser || '', o.client?.location?.latitude ?? '', o.client?.location?.longitude ?? '', o.client?.location?.accuracyMeters ?? '', o.client?.location?.capturedAt || '', o.vehicleType, o.vehicle, o.packageName, o.currency || 'USD', Number(o.amount || 0).toFixed(2), JSON.stringify(o.packageSnapshot || {}), o.status, o.agentName || '', o.paymentEvidence?.provider || '', o.paymentEvidence?.transactionId || '', o.paymentEvidence?.paymentIntentId || '', o.paymentEvidence?.status || '', o.paymentEvidence?.authorizedAt || '', o.paymentEvidence?.threeDSecure || '', o.paymentEvidence?.avsResult || '', o.paymentEvidence?.cvvResult || '', o.paymentEvidence?.cardBrand || '', o.paymentEvidence?.cardLast4 || '', o.reportUploadedAt || '', o.reportEvidence?.sha256 || '', o.reportEvidence?.sizeBytes || '', o.reportEvidence?.sentTo || '', o.reportEvidence?.deliveryChannel || '', o.reportEvidence?.deliveryStatus || '', o.reportEvidence?.deliveryReference || '', (o.downloadEvents || []).filter(x => x.completedAt).length, JSON.stringify(o.downloadEvents || []), o.internalNote || '']);
      const csv = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="vehicle-orders.csv"', 'Cache-Control': 'no-store' }); res.end(csv); return;
    }
    if (req.method === 'GET' && pathname === '/api/admin/orders') {
      const q = { from: cleanString(url.searchParams.get('from'), 10), to: cleanString(url.searchParams.get('to'), 10), name: cleanString(url.searchParams.get('name'), 120).toLowerCase(), phone: cleanString(url.searchParams.get('phone'), 60).toLowerCase(), vin: cleanString(url.searchParams.get('vin'), 40).toLowerCase(), status: cleanString(url.searchParams.get('status'), 40) };
      const orders = store.orders.filter(o => { const day = String(o.createdAt || '').slice(0, 10); return (!q.from || day >= q.from) && (!q.to || day <= q.to) && (!q.name || String(o.fullName || '').toLowerCase().includes(q.name)) && (!q.phone || String(o.phone || '').toLowerCase().includes(q.phone)) && (!q.vin || String(o.vehicle || '').toLowerCase().includes(q.vin)) && (!q.status || o.status === q.status || (q.status === 'delivered' && o.status === 'complete')); }).slice(0, 1000);
      return send(res, 200, { orders });
    }
    if ((req.method === 'DELETE' || req.method === 'POST') && pathname === '/api/admin/orders/bulk-delete') {
      const b = await body(req, 100000), ids = [...new Set(Array.isArray(b.ids) ? b.ids.map(x => cleanString(x, 80)).filter(Boolean) : [])].slice(0, 1000);
      if (!ids.length) return send(res, 400, { error: 'Select at least one order to delete.' });
      const removed = store.orders.filter(o => ids.includes(o.id));
      removed.forEach(o => { if (o.reportFile) { const file = path.join(REPORT_DIR, path.basename(o.reportFile)); if (file.startsWith(REPORT_DIR) && fs.existsSync(file)) fs.unlinkSync(file); } });
      store.orders = store.orders.filter(o => !ids.includes(o.id));
      log('orders.deleted', { count: removed.length, orderNumbers: removed.map(o => o.orderNumber || o.id) }, req);
      writeStore(store); return send(res, 200, { deleted: removed.length });
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/orders/')) {
      const id = pathname.slice('/api/admin/orders/'.length), index = store.orders.findIndex(o => o.id === id);
      if (index < 0) return send(res, 404, { error: 'Order not found.' });
      const [order] = store.orders.splice(index, 1);
      if (order.reportFile) { const file = path.join(REPORT_DIR, path.basename(order.reportFile)); if (file.startsWith(REPORT_DIR) && fs.existsSync(file)) fs.unlinkSync(file); }
      log('order.deleted', { orderNumber: order.orderNumber || order.id }, req); writeStore(store); return send(res, 200, { deleted: 1 });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/report-file')) {
      const id = pathname.slice('/api/admin/orders/'.length, -'/report-file'.length), order = store.orders.find(o => o.id === id);
      if (!order?.reportFile) return send(res, 404, { error: 'No report file is available for this order.' });
      const reportPath = path.join(REPORT_DIR, path.basename(order.reportFile));
      if (!reportPath.startsWith(REPORT_DIR) || !fs.existsSync(reportPath)) return send(res, 404, { error: 'Report file is unavailable.' });
      const fileName = cleanString(order.reportOriginalName || 'vehicle-report.pdf', 240).replace(/[\\/\\\\\x00-\x1f]/g, '_'), headerName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': fs.statSync(reportPath).size, 'Content-Disposition': `inline; filename="${headerName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(reportPath).pipe(res); return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/admin/orders/')) {
      const id = pathname.slice('/api/admin/orders/'.length), order = store.orders.find(o => o.id === id); if (!order) return send(res, 404, { error: 'Order not found.' }); return send(res, 200, { order });
    }
    if (req.method === 'POST' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/send-portal')) {
      const id = pathname.slice('/api/admin/orders/'.length, -'/send-portal'.length), order = store.orders.find(o => o.id === id); if (!order) return send(res, 404, { error: 'Order not found.' });
      if (!order.reportToken || !order.reportFile) return send(res, 400, { error: 'Upload the report before sending portal access.' });
      const portalUrl = `${(process.env.APP_BASE_URL || `http://${req.headers.host || 'localhost'}`).replace(/\/$/, '')}/portal/${encodeURIComponent(order.reportToken)}`;
      try {
        const messageId = await sendEmail(order.email, 'Your vehicle inspection report is ready', `Your report is ready. Open this secure portal link, enter the email address used for the order, and request a one-time code: ${portalUrl}`, `<p>Your vehicle report is ready.</p><p>Open <a href="${portalUrl}">your secure report portal</a>, enter the email address used for the order, and request a one-time verification code.</p><p>The PDF is only available after email verification.</p>`);
        const now = new Date().toISOString(); order.reportSentAt = now; order.reportEvidence = { ...(order.reportEvidence || {}), sentTo: order.email, deliveryChannel: 'email_portal', deliveryStatus: 'provider_accepted', deliveryReference: messageId, portalUrl };
        if (!Array.isArray(order.events)) order.events = []; order.events.push({ at: now, type: 'report_portal_email_submitted', sentTo: order.email, deliveryChannel: 'email_portal', deliveryStatus: 'provider_accepted', deliveryReference: messageId, portalUrl, actor: ADMIN_EMAIL, ipAddress: clientIp(req) });
        log('report.portal_email_submitted', { orderId: order.orderNumber || id, providerMessageId: messageId }, req); return send(res, 200, { order, messageId });
      } catch (error) { return send(res, 502, { error: `Could not send portal email. ${cleanString(error.message, 240)}` }); }
    }
    if (req.method === 'POST' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/report')) {
      const id = pathname.slice('/api/admin/orders/'.length, -'/report'.length), order = store.orders.find(o => o.id === id); if (!order) return send(res, 404, { error: 'Order not found.' });
      const b = await body(req, 16 * 1024 * 1024), match = String(b.data || '').match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/); if (!match) return send(res, 400, { error: 'Choose a PDF report file.' });
      const bytes = Buffer.from(match[1], 'base64'); if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'The report must be a valid PDF smaller than 10 MB.' });
      fs.mkdirSync(REPORT_DIR, { recursive: true }); const filename = `${order.id}.pdf`, originalName = cleanString(b.filename, 240).replace(/[\\/\\\\\x00-\x1f]/g, '_') || 'vehicle-report.pdf', uploadedAt = new Date().toISOString(), sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); fs.writeFileSync(path.join(REPORT_DIR, filename), bytes); order.reportFile = filename; order.reportOriginalName = originalName; order.reportToken = crypto.randomBytes(32).toString('base64url'); order.reportUploadedAt = uploadedAt; order.reportEvidence = { ...(order.reportEvidence || {}), sha256, sizeBytes: bytes.length, uploadedBy: ADMIN_EMAIL, sentTo: order.reportEvidence?.sentTo || order.email || '', deliveryChannel: order.reportEvidence?.deliveryChannel || '' }; if (!Array.isArray(order.events)) order.events = []; order.events.push({ at: uploadedAt, type: 'report_uploaded', ipAddress: clientIp(req), sha256, sizeBytes: bytes.length, uploadedBy: ADMIN_EMAIL }); log('report.uploaded', { orderId: order.orderNumber || id, sha256, sizeBytes: bytes.length }, req); return send(res, 200, { reportUploadedAt: order.reportUploadedAt, reportFileName: order.reportOriginalName, sha256, sizeBytes: bytes.length, downloadUrl: `/portal/${order.reportToken}` });
    }
    if (req.method === 'PUT' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/dispute-case')) {
      const id = pathname.slice('/api/admin/orders/'.length, -'/dispute-case'.length), order = store.orders.find(o => o.id === id); if (!order) return send(res, 404, { error: 'Order not found.' });
      const b = await body(req, 60000), allowed = ['policyDocumentsText','refundRefusalExplanation','refundPolicyDisclosureText','cancellationPolicyText','cancellationRefusalExplanation','cancellationPolicyDisclosureText','proofPolicyAcceptanceText','productDetailsTimelineText','accessLogsText','accessLogNarrative','additionalEvidenceConsentUseText'];
      const prior = order.disputeCase || {}, evidenceDraft = { ...(prior.evidenceDraft || {}) }, input = b.evidenceDraft && typeof b.evidenceDraft === 'object' ? b.evidenceDraft : {};
      for (const key of allowed) if (typeof input[key] === 'string') evidenceDraft[key] = cleanString(input[key], 16000);
      const now = new Date().toISOString(); order.disputeCase = { ...prior, stripeDisputeId: cleanString(b.stripeDisputeId ?? prior.stripeDisputeId, 120), reason: cleanString(b.reason ?? prior.reason, 120), status: cleanString(b.disputeStatus ?? prior.status, 60), dueBy: cleanString(b.dueBy ?? prior.dueBy, 60), amount: Number.isFinite(Number(b.disputeAmount)) && b.disputeAmount !== '' ? Math.max(0, Number(b.disputeAmount)) : (prior.amount ?? Number(order.amount || 0)), currency: cleanString(b.currency ?? prior.currency ?? order.currency ?? 'USD', 8), evidenceDraft, updatedAt: now, updatedBy: ADMIN_EMAIL };
      order.events ||= []; order.events.push({ at: now, type: 'dispute_case_draft_saved', actor: ADMIN_EMAIL, ipAddress: clientIp(req) }); log('dispute.case_draft_saved', { orderId: order.orderNumber || id, stripeDisputeId: order.disputeCase.stripeDisputeId }, req); return send(res, 200, { disputeCase: order.disputeCase });
    }
    if (req.method === 'PATCH' && pathname.startsWith('/api/admin/orders/')) {
      const id = pathname.slice('/api/admin/orders/'.length), order = store.orders.find(o => o.id === id); if (!order) return send(res, 404, { error: 'Order not found.' });
      const b = await body(req, 10000); if (b.status && !statuses.includes(b.status)) return send(res, 400, { error: 'Unknown order status.' });
      const now = new Date().toISOString(), facts = clientFacts(req), previousStatus = order.status, previousAgent = order.agentName || '';
      if (b.status) order.status = b.status; if (order.status === 'delivered' && previousStatus !== 'delivered' && !order.completedAt) order.completedAt = now;
      if (typeof b.agentName === 'string') order.agentName = cleanString(b.agentName, 100); if (typeof b.internalNote === 'string') order.internalNote = cleanString(b.internalNote, 1000);
      if (!Array.isArray(order.events)) order.events = [];
      if (order.status !== previousStatus) order.events.push({ at: now, type: 'status_changed', from: previousStatus, to: order.status, ipAddress: facts.ipAddress });
      if ((order.agentName || '') !== previousAgent) order.events.push({ at: now, type: 'agent_assigned', agentName: order.agentName || '', ipAddress: facts.ipAddress });
      if (b.reportSent === true) { if (!order.reportToken || !order.reportFile) return send(res, 400, { error: 'Upload the report before marking it sent.' }); order.reportSentAt = now; order.reportEvidence = { ...(order.reportEvidence || {}), sentTo: order.email || '', deliveryChannel: 'manual_link', deliveryStatus: 'operator_marked_sent', deliveryReference: cleanString(b.deliveryReference || order.reportEvidence?.deliveryReference, 200) }; order.events.push({ at: order.reportSentAt, type: 'report_marked_sent', ipAddress: facts.ipAddress, sentTo: order.email || '', deliveryChannel: 'manual_link', deliveryStatus: 'operator_marked_sent', deliveryReference: order.reportEvidence.deliveryReference, actor: ADMIN_EMAIL }); }
      log('order.updated', { orderId: id, status: order.status }, req); return send(res, 200, { order });
    }
    if (req.method === 'GET' && pathname === '/api/admin/logs') return send(res, 200, { logs: store.logs.slice(0, Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)))) });
    if (req.method === 'PUT' && pathname === '/api/admin/settings') {
      try {
        const b = await body(req, 300000), packages = validPackageList(b.packages), footer = validFooter(b.footer || {}), faqs = b.faqs === undefined ? (store.settings.faqs || defaultFaqs) : validFaqs(b.faqs), policyPages = b.policyPages === undefined ? (store.settings.policyPages || defaultPolicyPages) : validPolicyPages(b.policyPages), logoText = cleanString(b.logoText, 80), logoUrl = cleanString(b.logoUrl, 300);
        const countries = b.countries === undefined ? store.settings.countries : validCountries(b.countries), tawk = b.tawk === undefined ? store.settings.tawk : validTawk(b.tawk), currency = validCurrency(b.currency ?? store.settings.currency ?? 'USD');
        const pricingInput = b.pricingRules?.windowStickerDiscountPercentByPackage || store.settings.pricingRules?.windowStickerDiscountPercentByPackage || {};
        const pricingRules = { windowStickerDiscountPercentByPackage: Object.fromEntries(Object.entries(pricingInput).slice(0, 100).map(([id, rate]) => [cleanString(id, 80), Math.max(0, Math.min(100, Number(rate) || 0))])) };
        store.settings = { currency, packages, pricingRules, logoText: logoText || 'VINtrue', logoUrl: /^\/uploads\/logo-[a-f0-9-]+\.(png|jpg|webp)$/.test(logoUrl) ? logoUrl : '', footer, faqs, reviews: validReviews(store.settings.reviews || []), policyPages, countries, tawk };
        log('website.settings_updated', { packageCount: packages.length }, req); writeStore(store); return send(res, 200, { settings: store.settings });
      } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }
    if (req.method === 'POST' && pathname === '/api/admin/logo') {
      try {
        const b = await body(req, 2 * 1024 * 1024), raw = String(b.data || ''), match = raw.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/); if (!match) return send(res, 400, { error: 'Upload a PNG, JPG, or WebP image.' });
        const bytes = Buffer.from(match[2], 'base64'); if (!bytes.length || bytes.length > 1024 * 1024) return send(res, 400, { error: 'Logo must be smaller than 1 MB.' });
        const signatures = { png: '89504e470d0a1a0a', jpeg: 'ffd8ff', webp: '52494646' }; if (!bytes.subarray(0, signatures[match[1]].length / 2).toString('hex').startsWith(signatures[match[1]])) return send(res, 400, { error: 'Image file could not be verified.' });
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1], filename = `logo-${crypto.randomUUID()}.${ext}`, file = path.join(UPLOAD_DIR, filename); fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
        const old = store.settings.logoUrl; store.settings.logoUrl = `/uploads/${filename}`; log('website.logo_updated', {}, req);
        if (old && old.startsWith('/uploads/logo-')) { const oldPath = path.join(UPLOAD_DIR, path.basename(old)); if (oldPath.startsWith(UPLOAD_DIR) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }
        return send(res, 200, { logoUrl: store.settings.logoUrl });
      } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }
    return send(res, 404, { error: 'Admin endpoint not found.' });
  }
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) { const name = path.basename(pathname); if (name !== 'europe-flags.png' && !/^logo-[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) { res.writeHead(404); return res.end('Not found'); } return staticFile(res, path.join(UPLOAD_DIR, name)); }
  if (req.method === 'GET' && pathname === '/language.js') return staticFile(res, path.join(ROOT, 'language.js'), { 'Cache-Control': 'no-cache' });
  if (req.method === 'GET' && pathname === '/pricing-engine.js') return staticFile(res, path.join(ROOT, 'pricing-engine.js'), { 'Cache-Control': 'no-cache' });
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname.toLowerCase() === '/thank-you')) return staticFile(res, path.join(ROOT, 'index.html'));
  if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin.html')) return staticFile(res, path.join(ROOT, 'admin.html'));
  if (req.method === 'GET' && pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end('Not found');
}
const server = http.createServer((req, res) => { Promise.resolve(handle(req, res)).catch(err => { if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error.' }); else res.destroy(); if (!err.status) console.error(err); }); });
server.listen(PORT, HOST, () => console.log(`VINtrue website and admin panel running at http://${HOST}:${PORT}`));












