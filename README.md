# TPPL ERP — Vercel Deployment Guide

## Project Structure

```
tppl-erp/
├── api/
│   └── index.js          ← Express backend (Vercel serverless function)
├── public/
│   └── index.html        ← Frontend (served as static file)
├── vercel.json           ← Routes /api/* to backend, /* to public/
├── package.json
└── .env.example          ← Copy → .env for local dev
```

---

## Deploy to Vercel (3 steps)

### 1. Push to GitHub
```bash
cd tppl-erp
git init
git add .
git commit -m "Initial TPPL ERP"
git remote add origin https://github.com/YOUR_ORG/tppl-erp.git
git push -u origin main
```

### 2. Import in Vercel
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Framework: **Other** (no framework preset needed)
4. Root directory: leave as `/`
5. Click **Deploy** — Vercel reads `vercel.json` automatically

### 3. Set Environment Variables
In **Vercel Dashboard → Project → Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_EMAIL` | `your-sa@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | The full private key from `service_account.json` (paste as-is, Vercel handles newlines) |

Redeploy after setting env vars (Vercel → Deployments → Redeploy).

---

## Local Development

```bash
# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Fill in GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY

# Option A: Run the Express server locally
node api/index.js
# → API at http://localhost:5000
# → Open public/index.html in your browser

# Option B: Use Vercel CLI (mirrors production exactly)
npm install -g vercel
vercel dev
# → Everything at http://localhost:3000

# Test all sheet connections
node api/index.js --test
```

**Local vs Vercel API base:**
- In `public/index.html`, `PYTHON_API_BASE` is set to `''` (relative).
- This works on Vercel automatically.
- For local `node api/index.js` (port 5000), temporarily change it to `'http://localhost:5000'`
  or use `vercel dev` which serves everything on one port.

---

## Bugs Fixed

### Dispatch FMS not loading (`dispfms`)
1. **`applyAllData` was missing `dispfms`** — the `/api/erp-data` endpoint returned `dispfms`
   but `applyAllData()` never called `renderDispFmsTable()`. Fixed.

2. **`renderDispFmsTable` expected array-of-arrays** but API sends objects. Fixed — now
   detects format and handles both object arrays (API) and legacy raw arrays.

3. **`DISPATCH_FMS_HOLD_SHEET_ID` / `DISPATCH_FMS_DONE_SHEET_ID` were undefined** in the
   HTML — the `typeof` guard silently passed `''` as the sheet ID. Fixed — both IDs are
   now declared in `ERP_CONFIG` and referenced properly.

4. **`endpointMap` was missing dispatch endpoints** — Hold/Done writes went directly to
   Sheets API (CORS-blocked) instead of the backend proxy. Fixed — both endpoints added.

5. **`PYTHON_API_BASE` was hardcoded to `localhost:5000`** — breaks on Vercel. Fixed to
   `''` (relative URL, same-origin), which works on Vercel and with `vercel dev`.
