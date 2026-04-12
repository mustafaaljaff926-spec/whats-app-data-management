# Deploy online (shared by URL)

Hosting like Render **does not keep local files** between restarts. Set **`MONGODB_URI`** so orders live in [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) (free tier).

## 1. MongoDB Atlas

1. Create a cluster (free M0).
2. **Database Access** → add user (password).
3. **Network Access** → **Allow access from anywhere** `0.0.0.0/0` (needed for cloud hosts).
4. **Connect** → Drivers → copy the connection string.
5. Replace `<password>` with your user password. Example:  
   `mongodb+srv://user:YOURPASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. Authentication (recommended for a public URL)

Set these on your host (Render **Environment**):

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Long random string used to sign login tokens (e.g. 32+ characters). |
| `EDITOR_PASSWORD` | Full access: create, edit, delete, import, audit, reset. |
| `VIEWER_PASSWORD` | *(Optional.)* Read-only: list orders and export CSV. |

If **`AUTH_SECRET`** and at least one password are **not** set, the API stays **open** (fine for trusted local networks only).

### Team login vs accounts (MongoDB)

- **Team passwords** (`EDITOR_PASSWORD` / `VIEWER_PASSWORD`): one shared password per role — no email.
- **Email accounts** (optional): set **`ALLOW_USER_LOGIN=1`** with **`MONGODB_URI`**. Users sign in with email + password stored in the `users` collection.
- **Self-service sign up** (optional): set **`ALLOW_SIGNUP=1`** with **`MONGODB_URI`**. New users get the **viewer** role. Optional shared secret: **`SIGNUP_CODE`** (if set, registrants must provide it).

Sign up implies email login, so `ALLOW_USER_LOGIN` is effectively on when `ALLOW_SIGNUP=1`.

To **promote** a registered user to editor, in Atlas open the `users` collection and set `role` to `editor` for that document (or keep using shared `EDITOR_PASSWORD` for admins).

**URLs:** `https://your-site/login.html` and `signup.html` redirect to the app; or open `/?auth=login` and `/?auth=signup`.

### Password reset (email accounts)

Requires MongoDB, **`ALLOW_USER_LOGIN=1`** (or **`ALLOW_SIGNUP=1`**), **`AUTH_SECRET`**, SMTP, and a public base URL:

| Variable | Purpose |
|----------|---------|
| `PUBLIC_APP_URL` | App base URL with no trailing slash (e.g. `https://your-service.onrender.com`). Used in reset links (`/?reset=…`). |
| `SMTP_HOST` | Outbound mail server. |
| `SMTP_PORT` | Default `587`. |
| `SMTP_USER` / `SMTP_PASS` | Set if the server requires authentication. |
| `SMTP_SECURE` | Set `1` for implicit TLS (typical on port `465`). |
| `SMTP_FROM` | Sender address (e.g. `Banzeeni <noreply@example.com>`). |

Reset tokens are stored in the **`password_resets`** collection (TTL on `expiresAt`). The sign-in screen shows **Forgot password?** when this is fully configured.

### New-order notifications (email and/or SMS)

Sent when an editor **creates one order** through the app. **CSV import** does not send alerts (requests include `X-Skip-Order-Notify`).

| Variable | Purpose |
|----------|---------|
| `NOTIFY_EMAIL_TO` | Comma-separated recipient emails (requires the same **`SMTP_*`** variables as above). |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_PHONE_NUMBER` | Twilio “from” number (E.164). |
| `NOTIFY_SMS_TO` | Recipient number (E.164). |

### Daily report (zone / truck)

The **Reports** tab includes **Daily totals** (date picker + by zone / by truck). The API **`GET /api/reports/daily?date=YYYY-MM-DD`** returns the same JSON for authenticated users (any role).

## 3. Rate limits (abuse protection)

Defaults: **300** requests per 15 minutes per IP on API routes; **30** login attempts per 15 minutes per IP.

Override with `RATE_LIMIT_MAX` and `RATE_LIMIT_LOGIN_MAX` if needed.

## 4. Scheduled CSV backups (optional)

On a server with a **persistent disk** (or any machine where `backups/` is kept):

| Variable | Purpose |
|----------|---------|
| `BACKUP_INTERVAL_HOURS` | e.g. `24` — writes `backups/orders-<timestamp>.csv` on that interval. |
| `BACKUP_KEEP_COUNT` | Max files to keep (default `14`). |
| `BACKUP_ON_START` | Set to `1` to run one backup when the process starts. |

**MongoDB Atlas** also offers [cloud backups](https://www.mongodb.com/docs/atlas/backup/) on paid tiers; use that for database-level recovery.

## 5. Render (example)

1. Push this folder to a GitHub repository.
2. [Render](https://render.com) → **New** → **Web Service** → connect the repo.
3. **Build:** `npm install` — **Start:** `npm start`
4. **Environment** → add `MONGODB_URI`, then auth variables if you use them.
5. Deploy and open the URL Render gives you.

## 6. Local vs online

- **Local:** leave `MONGODB_URI` unset → data stays in `orders.json` (and `audit.json` when you use audit).
- **Online:** set `MONGODB_URI` → the app uses MongoDB for orders and audit.

Optional: `MONGODB_DB` (default `fuel_app`), `PORT` (set by the host), `AUTH_TOKEN_DAYS` (JWT lifetime, default `7d`).
