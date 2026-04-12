# Deploy online (shared by URL)

Hosting like Render or Railway **does not keep a local `orders.json`** between restarts. Set **`MONGODB_URI`** so orders live in [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) (free tier).

## 1. MongoDB Atlas

1. Create a cluster (free M0).
2. **Database Access** → add user (password).
3. **Network Access** → **Allow access from anywhere** `0.0.0.0/0` (needed for cloud hosts).
4. **Connect** → Drivers → copy the connection string.
5. Replace `<password>` with your user password. Example:
   `mongodb+srv://user:YOURPASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. Render (example)

1. Push this folder to a GitHub repository.
2. [Render](https://render.com) → **New** → **Web Service** → connect the repo.
3. **Build:** `npm install` — **Start:** `npm start`
4. **Environment** → add `MONGODB_URI` = your Atlas string.
5. Deploy. Open the URL Render gives you (e.g. `https://fuel-order-management.onrender.com`).

## 3. Local vs online

- **Local:** leave `MONGODB_URI` unset → data stays in `orders.json`.
- **Online:** set `MONGODB_URI` → same app code uses MongoDB; everyone using that site URL shares one database.

## 4. Optional

- `MONGODB_DB` — database name (default: `fuel_app`).
- `PORT` — set automatically on most hosts.
