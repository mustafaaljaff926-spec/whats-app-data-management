const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let APP_VERSION = '2.0.0';
try {
  APP_VERSION = require('./package.json').version;
} catch (e) {}

const app = express();
const port = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'orders.json');
const AUDIT_FILE = path.join(__dirname, 'audit.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

let mongoCollection = null;
let mongoClient = null;
let auditCollection = null;
let usersCollection = null;
let passwordResetsCollection = null;

const AUTH_SECRET = process.env.AUTH_SECRET || '';
const EDITOR_PW = process.env.EDITOR_PASSWORD || '';
const VIEWER_PW = process.env.VIEWER_PASSWORD || '';
/** Email/password accounts in users.json when MongoDB is not used. */
const USE_LOCAL_USERS = process.env.USE_LOCAL_USERS === '1';
const LOCAL_USERS_FILE = path.join(__dirname, 'users.json');
/** Self-serve signups (MongoDB or local users file). */
const signupEnabledFlag =
  process.env.ALLOW_SIGNUP === '1' && (!!process.env.MONGODB_URI || USE_LOCAL_USERS);
/** Email/password login: Mongo or local file. */
const userLoginEnabledFlag =
  (!!process.env.MONGODB_URI && (process.env.ALLOW_USER_LOGIN === '1' || signupEnabledFlag)) ||
  (USE_LOCAL_USERS &&
    !!AUTH_SECRET &&
    (process.env.ALLOW_USER_LOGIN === '1' || signupEnabledFlag));
const authEnabled = Boolean(AUTH_SECRET && (EDITOR_PW || VIEWER_PW || userLoginEnabledFlag));

function readLocalUsers() {
  try {
    const raw = fs.readFileSync(LOCAL_USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users) {
  fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function localUserStoreReady() {
  return USE_LOCAL_USERS && !!AUTH_SECRET;
}
const TOKEN_EXPIRY = process.env.AUTH_TOKEN_DAYS ? `${process.env.AUTH_TOKEN_DAYS}d` : '7d';

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());

const skipHealth = (req) => req.path === '/health' || req.path === '/api/auth/status';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipHealth,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(apiLimiter);

/** Landing page: sign-in first; open `index.html` for the app (or use links on login.html). */
app.get('/', (req, res) => {
  res.redirect(302, '/login.html');
});

app.use(express.static('.'));

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

function smtpReady() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function passwordResetEnabled() {
  return Boolean(
    userLoginEnabledFlag && usersCollection && passwordResetsCollection && smtpReady() && process.env.PUBLIC_APP_URL
  );
}

let cachedMailer = null;
function getMailer() {
  if (!smtpReady()) return null;
  if (cachedMailer) return cachedMailer;
  const nodemailer = require('nodemailer');
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  cachedMailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === '1' || port === 465,
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
        : undefined,
  });
  return cachedMailer;
}

async function sendTransactionalEmail(to, subject, text, html) {
  const transport = getMailer();
  if (!transport) return false;
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html: html || text,
  });
  return true;
}

function notifyEmailConfigured() {
  return smtpReady() && !!process.env.NOTIFY_EMAIL_TO;
}

function notifySmsConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER &&
    process.env.NOTIFY_SMS_TO
  );
}

async function sendSmsTwilio(body) {
  if (!notifySmsConfigured()) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams({
    To: process.env.NOTIFY_SMS_TO,
    From: process.env.TWILIO_PHONE_NUMBER,
    Body: body,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Twilio SMS failed:', res.status, t);
  }
}

async function notifyNewOrder(order) {
  const lines = [
    `New fuel order #${order.id}`,
    `Date: ${order.date}`,
    `Customer: ${order.name}`,
    `Phone: ${order.phone}`,
    `Zone: ${order.zone}`,
    `Truck: ${order.truck}`,
    `Rider: ${order.rider || '—'}`,
    `Fuel: ${order.fuel}`,
    `IQD: ${order.price}`,
    `Liters: ${order.liters}`,
    `Status: ${order.status}`,
  ];
  const text = lines.join('\n');
  if (notifyEmailConfigured()) {
    const recipients = process.env.NOTIFY_EMAIL_TO.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const to of recipients) {
      try {
        await sendTransactionalEmail(to, `New order #${order.id} — ${order.zone}`, text, `<pre>${text.replace(/</g, '&lt;')}</pre>`);
      } catch (e) {
        console.error('Order notify email failed:', e.message || e);
      }
    }
  }
  if (notifySmsConfigured()) {
    try {
      await sendSmsTwilio(text.slice(0, 1500));
    } catch (e) {
      console.error('Order notify SMS failed:', e.message || e);
    }
  }
}

function orderDateKey(dateStr) {
  const s = String(dateStr || '').trim();
  if (!s) return null;
  const p = s.split('/');
  if (p.length === 3) {
    const m = parseInt(p[0], 10);
    const d = parseInt(p[1], 10);
    const y = parseInt(p[2], 10);
    if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function aggregateOrdersForDay(orders, dayIso) {
  const day = String(dayIso || '').slice(0, 10);
  const inDay = orders.filter((o) => orderDateKey(o.date) === day);
  const byZone = {};
  const byTruck = {};
  let liters = 0;
  let revenue = 0;
  for (const o of inDay) {
    liters += Number(o.liters) || 0;
    revenue += Number(o.price) || 0;
    const z = o.zone || '—';
    const t = o.truck || '—';
    if (!byZone[z]) byZone[z] = { zone: z, count: 0, liters: 0, revenue: 0 };
    if (!byTruck[t]) byTruck[t] = { truck: t, count: 0, liters: 0, revenue: 0 };
    byZone[z].count++;
    byZone[z].liters += Number(o.liters) || 0;
    byZone[z].revenue += Number(o.price) || 0;
    byTruck[t].count++;
    byTruck[t].liters += Number(o.liters) || 0;
    byTruck[t].revenue += Number(o.price) || 0;
  }
  const sortDesc = (arr, key) => arr.sort((a, b) => b[key] - a[key]);
  const zones = sortDesc(Object.values(byZone), 'liters');
  const trucks = sortDesc(Object.values(byTruck), 'liters');
  return {
    date: day,
    orderCount: inDay.length,
    totalLiters: liters,
    totalRevenue: revenue,
    byZone: zones,
    byTruck: trucks,
  };
}

app.get('/api/auth/status', (req, res) => {
  const userStore = Boolean(usersCollection || localUserStoreReady());
  res.json({
    authEnabled,
    version: APP_VERSION,
    signupEnabled: Boolean(signupEnabledFlag && userStore),
    teamLoginEnabled: Boolean(EDITOR_PW || VIEWER_PW),
    userLoginEnabled: Boolean(userLoginEnabledFlag && userStore),
    openAccess: !authEnabled,
    passwordResetEnabled: passwordResetEnabled(),
    notifyEmailEnabled: notifyEmailConfigured(),
    notifySmsEnabled: notifySmsConfigured(),
  });
});

function parseOrderBody(raw) {
  return {
    date: String(raw.date ?? ''),
    name: String(raw.name ?? ''),
    phone: String(raw.phone ?? ''),
    zone: String(raw.zone ?? ''),
    truck: String(raw.truck ?? ''),
    rider: raw.rider == null ? '' : String(raw.rider),
    fuel: String(raw.fuel ?? ''),
    price: Number(raw.price),
    liters: Number(raw.liters),
    status: String(raw.status ?? ''),
    notes: raw.notes == null ? '' : String(raw.notes),
  };
}

function validateOrderBody(o) {
  if (!o.date || o.date.length > 120) return 'Invalid or missing date';
  if (o.name.length > 500) return 'Customer name too long';
  if (o.phone.length > 80) return 'Phone too long';
  if (!o.zone || o.zone.length > 300) return 'Invalid zone';
  if (o.truck.length > 40) return 'Invalid truck';
  if (o.rider.length > 200) return 'Invalid rider';
  if (!['Muhasan', 'Super'].includes(o.fuel)) return 'Invalid fuel type';
  if (!['Completed', 'Cancelled', 'Pending'].includes(o.status)) return 'Invalid status';
  if (!Number.isFinite(o.price) || o.price < 0 || o.price > 1e15) return 'Invalid price';
  if (!Number.isFinite(o.liters) || o.liters < 0 || o.liters > 1e9) return 'Invalid liters';
  if (o.notes.length > 5000) return 'Notes too long';
  return null;
}

function orderBodyMiddleware(req, res, next) {
  const o = parseOrderBody(req.body);
  const err = validateOrderBody(o);
  if (err) return res.status(400).json({ error: err });
  req.body = o;
  next();
}

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    if (!authEnabled) {
      return res.status(400).json({ error: 'Authentication is not configured on this server' });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email) {
      let role = null;
      if (EDITOR_PW && password === EDITOR_PW) role = 'editor';
      else if (VIEWER_PW && password === VIEWER_PW) role = 'viewer';
      if (!role) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ role, kind: 'team' }, AUTH_SECRET, { expiresIn: TOKEN_EXPIRY });
      return res.json({ token, role });
    }

    if (!userLoginEnabledFlag) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    let user = null;
    if (usersCollection) {
      user = await usersCollection.findOne({ email });
    } else if (localUserStoreReady()) {
      user = readLocalUsers().find((u) => u.email === email) || null;
    } else {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const role = user.role === 'editor' ? 'editor' : 'viewer';
    const token = jwt.sign({ role, kind: 'user', email }, AUTH_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, role });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', loginLimiter, async (req, res) => {
  try {
    if (!signupEnabledFlag) {
      return res.status(403).json({ error: 'Registration is disabled' });
    }
    if (!usersCollection && !localUserStoreReady()) {
      return res.status(403).json({ error: 'Registration is disabled' });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const code = String(req.body.signupCode || '');
    const needCode = process.env.SIGNUP_CODE || '';
    if (needCode && code !== needCode) {
      return res.status(403).json({ error: 'Invalid signup code' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(password, 10);
    if (usersCollection) {
      await usersCollection.insertOne({
        email,
        passwordHash,
        role: 'viewer',
        createdAt: new Date(),
      });
    } else {
      const list = readLocalUsers();
      if (list.some((u) => u.email === email)) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      list.push({
        email,
        passwordHash,
        role: 'viewer',
        createdAt: new Date().toISOString(),
      });
      writeLocalUsers(list);
    }
    res.json({ success: true });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Could not register' });
  }
});

app.post('/api/auth/forgot-password', loginLimiter, async (req, res) => {
  const generic = { ok: true, message: 'If that email is registered, you will receive reset instructions shortly.' };
  try {
    if (!passwordResetEnabled()) {
      return res.json(generic);
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json(generic);
    }
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.json(generic);
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await passwordResetsCollection.deleteMany({ email });
    await passwordResetsCollection.insertOne({ email, token, expiresAt });
    const base = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    const link = `${base}/?reset=${encodeURIComponent(token)}`;
    const text = `Reset your Banzeeni password:\n\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`;
    const html = `<p>Reset your Banzeeni password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`;
    await sendTransactionalEmail(email, 'Reset your password', text, html);
    return res.json(generic);
  } catch (e) {
    console.error('forgot-password:', e);
    return res.json(generic);
  }
});

app.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
  try {
    if (!passwordResetsCollection || !usersCollection) {
      return res.status(503).json({ error: 'Password reset is not available' });
    }
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!token || token.length < 20) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const row = await passwordResetsCollection.findOne({ token });
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const r = await usersCollection.updateOne({ email: row.email }, { $set: { passwordHash } });
    if (r.matchedCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    await passwordResetsCollection.deleteMany({ email: row.email });
    res.json({ ok: true, message: 'Password updated. You can sign in.' });
  } catch (e) {
    console.error('reset-password:', e);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

function requireAuth(req, res, next) {
  if (!authEnabled) return next();
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(h.slice(7), AUTH_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireEditor(req, res, next) {
  if (!authEnabled) return next();
  if (req.user.role !== 'editor') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function readOrdersFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeOrdersFile(orders) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function readAuditFile() {
  try {
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAuditFile(entries) {
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function stripMongoId(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, ...rest } = doc;
  return rest;
}

async function initMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  const dbName = process.env.MONGODB_DB || 'fuel_app';
  mongoCollection = mongoClient.db(dbName).collection('orders');
  auditCollection = mongoClient.db(dbName).collection('audit_log');
  usersCollection = mongoClient.db(dbName).collection('users');
  passwordResetsCollection = mongoClient.db(dbName).collection('password_resets');
  await mongoCollection.createIndex({ id: 1 }, { unique: true });
  await auditCollection.createIndex({ ts: -1 });
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await passwordResetsCollection.createIndex({ token: 1 }, { unique: true });
  await passwordResetsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  console.log('Using MongoDB for order storage (online)');
}

async function getOrdersList() {
  if (mongoCollection) {
    const docs = await mongoCollection.find({}).toArray();
    return docs.map(stripMongoId);
  }
  return readOrdersFile();
}

function nextId(orders) {
  if (!orders.length) return 1;
  return Math.max(...orders.map((o) => Number(o.id))) + 1;
}

async function appendAudit(entry) {
  const row = {
    ts: new Date(),
    actor: entry.actor,
    role: entry.role,
    action: entry.action,
    orderId: entry.orderId != null ? entry.orderId : undefined,
    detail: entry.detail,
  };
  if (auditCollection) {
    await auditCollection.insertOne(row);
  } else {
    const forFile = { ...row, ts: row.ts.toISOString() };
    const list = readAuditFile();
    list.push(forFile);
    const max = parseInt(process.env.AUDIT_MAX_ENTRIES || '2000', 10);
    while (list.length > max) list.shift();
    writeAuditFile(list);
  }
}

function actorLabel(req) {
  if (!authEnabled) return 'anonymous';
  if (req.user && req.user.email) return req.user.email;
  return req.user && req.user.role ? req.user.role : 'unknown';
}

function buildCsvRows(orders) {
  const header = 'Date,Customer,Phone,Zone,Truck,Rider,Fuel,Price,Liters,Status,Notes';
  const rows = orders.map((o) =>
    [
      o.date,
      `"${String(o.name || '').replace(/"/g, '""')}"`,
      o.phone,
      `"${String(o.zone || '').replace(/"/g, '""')}"`,
      o.truck,
      `"${String(o.rider || '').replace(/"/g, '""')}"`,
      o.fuel,
      o.price,
      o.liters,
      o.status,
      `"${String(o.notes || '').replace(/"/g, '""')}"`,
    ].join(',')
  );
  return `${header}\n${rows.join('\n')}`;
}

async function runScheduledBackup() {
  const list = await getOrdersList();
  const csv = buildCsvRows(list);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(BACKUP_DIR, `orders-${stamp}.csv`);
  fs.writeFileSync(filePath, csv, 'utf8');
  console.log(`Backup written: ${filePath}`);
  const keep = parseInt(process.env.BACKUP_KEEP_COUNT || '14', 10);
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('orders-') && f.endsWith('.csv'))
    .map((f) => ({
      f,
      t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.t - a.t);
  for (let i = keep; i < files.length; i++) {
    fs.unlinkSync(path.join(BACKUP_DIR, files[i].f));
  }
}

app.get('/orders', requireAuth, async (req, res) => {
  try {
    const list = await getOrdersList();
    res.json(list.sort((a, b) => Number(b.id) - Number(a.id)));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/orders', requireAuth, requireEditor, orderBodyMiddleware, async (req, res) => {
  try {
    const { date, name, phone, zone, truck, rider, fuel, price, liters, status, notes } = req.body;
    let id;
    if (mongoCollection) {
      const all = await getOrdersList();
      id = nextId(all);
      await mongoCollection.insertOne({
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      });
    } else {
      const orders = readOrdersFile();
      id = nextId(orders);
      orders.push({
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      });
      writeOrdersFile(orders);
    }
    await appendAudit({
      actor: actorLabel(req),
      role: req.user?.role || 'editor',
      action: 'ORDER_CREATE',
      orderId: id,
    });
    const skipNotify = String(req.get('x-skip-order-notify') || '') === '1';
    if (!skipNotify && (notifyEmailConfigured() || notifySmsConfigured())) {
      notifyNewOrder({
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      }).catch((err) => console.error('notifyNewOrder:', err));
    }
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/reports/daily', requireAuth, async (req, res) => {
  try {
    let day = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      day = new Date().toISOString().slice(0, 10);
    }
    const list = await getOrdersList();
    res.json(aggregateOrdersForDay(list, day));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/orders/:id', requireAuth, requireEditor, orderBodyMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, name, phone, zone, truck, rider, fuel, price, liters, status, notes } = req.body;
    if (mongoCollection) {
      const r = await mongoCollection.replaceOne(
        { id },
        {
          id,
          date,
          name,
          phone,
          zone,
          truck,
          rider,
          fuel,
          price,
          liters,
          status,
          notes,
        }
      );
      if (r.matchedCount === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
    } else {
      const orders = readOrdersFile();
      const idx = orders.findIndex((o) => Number(o.id) === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Order not found' });
      }
      orders[idx] = {
        id,
        date,
        name,
        phone,
        zone,
        truck,
        rider,
        fuel,
        price,
        liters,
        status,
        notes,
      };
      writeOrdersFile(orders);
    }
    await appendAudit({
      actor: actorLabel(req),
      role: req.user?.role || 'editor',
      action: 'ORDER_UPDATE',
      orderId: id,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/orders/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (mongoCollection) {
      await mongoCollection.deleteOne({ id });
    } else {
      const orders = readOrdersFile().filter((o) => Number(o.id) !== id);
      writeOrdersFile(orders);
    }
    await appendAudit({
      actor: actorLabel(req),
      role: req.user?.role || 'editor',
      action: 'ORDER_DELETE',
      orderId: id,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/orders/reset-all', requireAuth, requireEditor, async (req, res) => {
  try {
    const list = await getOrdersList();
    if (mongoCollection) {
      await mongoCollection.deleteMany({});
    } else {
      writeOrdersFile([]);
    }
    await appendAudit({
      actor: actorLabel(req),
      role: req.user?.role || 'editor',
      action: 'RESET_ALL',
      detail: { deletedCount: list.length },
    });
    res.json({ success: true, deletedCount: list.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/audit/event', requireAuth, requireEditor, async (req, res) => {
  try {
    const { action, orderId, detail } = req.body;
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action required' });
    }
    await appendAudit({
      actor: actorLabel(req),
      role: req.user?.role || 'editor',
      action,
      orderId: orderId != null ? Number(orderId) : undefined,
      detail,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/audit', requireAuth, requireEditor, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    if (auditCollection) {
      const rows = await auditCollection.find({}).sort({ ts: -1 }).limit(limit).toArray();
      res.json(rows.map((doc) => stripMongoId(doc)));
    } else {
      const list = readAuditFile();
      res.json(list.slice(-limit).reverse());
    }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const host = process.env.HOST || '0.0.0.0';

initMongo()
  .then(() => {
    const hours = process.env.BACKUP_INTERVAL_HOURS;
    if (hours) {
      const ms = parseFloat(hours) * 3600000;
      if (ms >= 60000) {
        setInterval(() => {
          runScheduledBackup().catch((err) => console.error('Backup failed', err));
        }, ms);
        if (process.env.BACKUP_ON_START === '1') {
          runScheduledBackup().catch((err) => console.error('Backup failed', err));
        }
        console.log(`Scheduled CSV backup every ${hours} hour(s) → ${BACKUP_DIR}`);
      }
    }
    app.listen(port, host, () => {
      const backend = mongoCollection ? 'MongoDB' : `file (${path.basename(DATA_FILE)})`;
      const authMsg = authEnabled ? 'auth: on' : 'auth: off';
      const usersMsg =
        USE_LOCAL_USERS && localUserStoreReady()
          ? `; accounts: ${path.basename(LOCAL_USERS_FILE)}`
          : usersCollection
            ? '; accounts: MongoDB'
            : '';
      console.log(`Server on port ${port} — storage: ${backend}; ${authMsg}${usersMsg}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
