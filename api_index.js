/**
 * TPPL ERP — Google Sheets Dynamic Data Fetcher (Node.js)
 * =========================================================
 *
 * SETUP:
 * 1. npm install express cors
 * 2. Place service_account.json next to this file  (or set env vars — see below)
 * 3. Share every sheet with the service account email
 * 4. node api_index.js
 * 5. HTML frontend fetches from http://localhost:5000/api/erp-data
 *
 * ENV VARS (optional — overrides service_account.json, required for Vercel):
 *   GOOGLE_CLIENT_EMAIL   → client_email from service_account.json
 *   GOOGLE_PRIVATE_KEY    → private_key  from service_account.json
 *
 * SHEET MAP (confirmed from Google Drive):
 *   Main data spreadsheet    → "data spreadsheet"          1MgsPCBWo-GGbGf-I_Y0LRCtY64B1aVbVQQYpTqFI4NY
 *     Tabs: Dispatch, order, pending sales, Stock, Production Requirement
 *
 *   Dispatch FMS source      → "New Dispatch fms DEC 2025" 17JDVzgF7pK_7C25_k8VKIlC4gbizdASaYjob2JDQWzo
 *     Tab: DATA
 *
 *   O2D / FMS source         →                             1A3wZ4PvmuNn3TWOI96W3IUK62oxOFzY6_JueiaXBuKA
 *     Tab: o2d
 *
 *   Collection FMS log       → "TPPL Collection FMS"       1nqIlxfNARypJycUBCKL736Vm082gAOBC3ljdUUm6x4s
 *     (call-later write target)
 *
 *   FMS done log             →                             1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4
 *   O2D call-later           →                             19H9thoVTStj7kCBOoODvpGD7T2I9uj01FrQbqBQY6A0
 *   O2D done log             →                             1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4
 *     ⚠ VERIFY: FMS done and O2D done currently point to the same sheet ID.
 *       If they should be separate, update O2D_DONE_SHEET_ID below.
 *   Dispatch FMS Hold log    →                             14tSrq3GAFtY144Wp9DbW3Q6_isIIr2u2PIJM5O7b478
 *   Dispatch FMS Done log    →                             1zhZQeU4nr2P8JUFJJK1a9gs1li34xZT-zpzAR9KEgoQ
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const cors    = require('cors');

// ══════════════════════════════════════════════════════════════════════════════
// SHEET IDs
// ══════════════════════════════════════════════════════════════════════════════

// Main ERP data spreadsheet (tabs: order, pending sales, Dispatch, Stock, Production Requirement)
const SPREADSHEET_ID             = '1MgsPCBWo-GGbGf-I_Y0LRCtY64B1aVbVQQYpTqFI4NY';

// "New Dispatch fms DEC 2025" — source data for Dispatch FMS UI (tab: DATA)
const DISPATCH_FMS_SOURCE_ID     = '17JDVzgF7pK_7C25_k8VKIlC4gbizdASaYjob2JDQWzo';

// O2D pipeline source sheet (tab: o2d) — also used for FMS advance orders
// FIX: was incorrectly reused as FMS_SHEET_ID (Collection FMS). Kept separate now.
const O2D_SOURCE_SHEET_ID        = '1A3wZ4PvmuNn3TWOI96W3IUK62oxOFzY6_JueiaXBuKA';

// Collection FMS sheet — "TPPL Collection FMS" — has the 'o2d' tab with ADVANCE orders
// FIX: previously this was wrong. FMS_SHEET_ID now correctly points to the Collection FMS sheet.
const FMS_SHEET_ID               = '1nqIlxfNARypJycUBCKL736Vm082gAOBC3ljdUUm6x4s';

// Write targets
const CALL_LATER_SHEET_ID        = '1nqIlxfNARypJycUBCKL736Vm082gAOBC3ljdUUm6x4s'; // Collection FMS call-later log
const DONE_SHEET_ID              = '1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4'; // Collection FMS done log
const O2D_CALL_LATER_ID          = '19H9thoVTStj7kCBOoODvpGD7T2I9uj01FrQbqBQY6A0'; // O2D call-later log
// FIX: O2D_DONE_SHEET_ID was identical to DONE_SHEET_ID (Collection FMS done).
//      ⚠ Replace the ID below with the correct O2D-done sheet ID if it is a different sheet.
const O2D_DONE_SHEET_ID          = '1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4'; // ← verify / update
const DISPATCH_FMS_HOLD_SHEET_ID = '14tSrq3GAFtY144Wp9DbW3Q6_isIIr2u2PIJM5O7b478'; // Dispatch FMS hold log
const DISPATCH_FMS_DONE_SHEET_ID = '1zhZQeU4nr2P8JUFJJK1a9gs1li34xZT-zpzAR9KEgoQ'; // Dispatch FMS done log

// Tab names for write targets (must match exactly what's in each Google Sheet)
const CALL_LATER_TAB             = 'Sheet1'; // ← update if your tab is named differently
const DONE_TAB                   = 'Sheet1'; // ← update if your tab is named differently
const O2D_CALL_LATER_TAB         = 'Sheet1'; // ← update if your tab is named differently
const O2D_DONE_TAB               = 'Sheet1'; // ← update if your tab is named differently
const DISPATCH_FMS_HOLD_TAB      = 'Sheet1'; // ← update if your tab is named differently
const DISPATCH_FMS_DONE_TAB      = 'Sheet1'; // ← update if your tab is named differently

const RATE_CL_SHEET_URL =
  'https://script.google.com/a/macros/takkarpolychem.com/s/' +
  'AKfycbysaa_5eoEQjD2G57IRnPzV0O2YNo-WfPWxweyoSAK5j1kwbmUe5Q4nvX6PiYz0cSQ/exec';

const SERVICE_ACCOUNT_FILE = 'service_account.json';
const O2D_PLAN_DAYS        = 3;
const PORT                 = 5000;

const app = express();
app.use(cors());
app.use(express.json());


// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE AUTH — JWT → access token
// ══════════════════════════════════════════════════════════════════════════════

function loadCredentials() {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    throw new Error(
      `'${SERVICE_ACCOUNT_FILE}' not found and GOOGLE_CLIENT_EMAIL env var not set. ` +
      'Place service_account.json next to this file or set environment variables.'
    );
  }
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
  return { client_email: sa.client_email, private_key: sa.private_key };
}

async function getAccessToken() {
  const { client_email, private_key } = loadCredentials();

  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const header   = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload  = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const unsigned = `${header}.${payload}`;

  const keyPem = private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(keyPem, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned)
  );

  const jwt = `${unsigned}.${Buffer.from(sigBuffer).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(json));
  return json.access_token;
}


// ══════════════════════════════════════════════════════════════════════════════
// LOW-LEVEL SHEET HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all rows from a sheet tab as array-of-objects.
 * First row = headers. Headers are trimmed but case-preserved.
 */
async function fetchSheetAsRecords(spreadsheetId, sheetName) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API error ${res.status} for sheet "${sheetName}": ${await res.text()}`);
  const { values = [] } = await res.json();
  if (values.length < 2) return [];
  const [headers, ...rows] = values;
  return rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [String(h).trim(), row[i] ?? '']))
  );
}

/**
 * Append one row to a sheet tab.
 */
async function appendRowToSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAccessToken();
  const url   =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/` +
    `${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values: [rowData] }),
  });
  if (!res.ok) throw new Error(`Sheets append error ${res.status} for sheet "${sheetName}": ${await res.text()}`);
}

/** Safe float conversion */
function toFloat(value) {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return isNaN(n) ? 0.0 : n;
}

/**
 * FIX: appendEndpoint now always receives an explicit sheetName.
 * Previously the default 'Sheet1' was silently used without being passed,
 * risking writes going to the wrong tab.
 */
async function appendEndpoint(req, res, sheetId, sheetName) {
  if (!sheetName) {
    return res.status(500).json({ ok: false, error: 'Internal config error: sheetName not specified.' });
  }
  const row = (req.body || {}).row || [];
  if (!row.length) return res.status(400).json({ ok: false, error: 'No row data provided' });
  try {
    await appendRowToSheet(sheetId, sheetName, row);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// DATA FETCH FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSalesOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'order');
}

async function fetchPendingOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'pending sales');
}

async function fetchDispatchOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Dispatch');
}

/**
 * Dispatch FMS — reads tab 'DATA' from "New Dispatch fms DEC 2025" sheet.
 *
 * FIX: The previous column mapping used hardcoded strings that may not match
 * the actual sheet headers exactly (e.g. 'Machine no' vs 'Machine No',
 * 'PRODUCT NAME' vs 'Product Name'). The new approach:
 *   1. Reads raw records.
 *   2. Builds a case-insensitive header lookup so minor capitalisation
 *      differences in the sheet never silently blank out a field.
 *   3. Logs actual headers on first call (check Vercel logs) so you can
 *      confirm or adjust the mapping below.
 */
async function fetchDispatchFms() {
  const records = await fetchSheetAsRecords(DISPATCH_FMS_SOURCE_ID, 'DATA');

  if (records.length === 0) return [];

  // Log actual headers once so you can verify the mapping in Vercel logs
  console.log('[fetchDispatchFms] actual column headers:', Object.keys(records[0]));

  return records.map(r => {
    // Build a lowercase → original-value lookup for case-insensitive access
    const ci = {};
    for (const [k, v] of Object.entries(r)) {
      ci[k.toLowerCase().trim()] = v;
    }

    return {
      'Timestamp':    ci['timestamp']                              || '',
      // 'Date of Dispatch' is the most common header; 'Date' as fallback
      'Date':         ci['date of dispatch'] || ci['date']         || '',
      'Party Name':   ci['party name']                             || '',
      'PO':           ci['po']                                     || '',
      'SO':           ci['so']                                     || '',
      'Invoice No':   ci['invoice no']                             || '',
      'Item Name':    ci['item name']                              || '',
      'Qty':          toFloat(ci['qty']),
      // Sheet uses 'Machine no' (lowercase o) — ci handles both
      'Machine No':   ci['machine no']                             || '',
      // Sheet alternates between 'PRODUCT NAME' and 'Product Name'
      'Product Name': ci['product name']                           || '',
      'WA Status':    ci['wa status']                              || '',
    };
  });
}

async function fetchStockRegister() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Stock');
}

async function fetchProductionRequirements() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Production Requirement');
}

/**
 * Collection FMS advance orders.
 *
 * FIX: Previously FMS_SHEET_ID was set to the O2D source sheet ID
 * (1A3wZ4PvmuNn3TWOI96W3IUK62oxOFzY6_JueiaXBuKA), which does not have
 * an 'o2d' tab with ADVANCE orders. FMS_SHEET_ID is now correctly set to
 * the "TPPL Collection FMS" sheet (1nqIlxfNARypJycUBCKL736Vm082gAOBC3ljdUUm6x4s).
 */
async function fetchFmsAdvanceOrders() {
  const raw       = await fetchSheetAsRecords(FMS_SHEET_ID, 'o2d');
  const ordersMap = {};

  for (const row of raw) {
    if (String(row['Payment Terms'] || '').trim().toUpperCase() !== 'ADVANCE') continue;
    const soNo = String(row['SO No'] || '').trim();
    if (!soNo) continue;

    if (!ordersMap[soNo]) {
      ordersMap[soNo] = {
        'SO No':         row['SO No']      || '',
        'Date':          row['Date']        || '',
        'Client Name':   row['Client Name'] || '',
        'Payment Terms': 'ADVANCE',
        'PO Number':     row['PO Number']   || '',
        'Total Qty':     0,
        'Amount':        0.0,
        'Total Bill':    0.0,
        'Items':         0,
        'CRM Status':    'Pending Call',
        'items':         [],
      };
    }

    const qty    = toFloat(row['Qty']);
    const amount = toFloat(row['Amount']);
    const total  = toFloat(row['Total']);

    ordersMap[soNo]['Total Qty']  += qty;
    ordersMap[soNo]['Amount']     += amount;
    ordersMap[soNo]['Total Bill'] += total;
    ordersMap[soNo]['Items']      += 1;
    ordersMap[soNo]['items'].push(row);
  }

  return Object.values(ordersMap);
}

/**
 * O2D pipeline — reads tab 'Sheet1' from O2D_SOURCE_SHEET_ID.
 * Computes Plan_Date = SO_Date + O2D_PLAN_DAYS.
 */
async function fetchO2dPipeline() {
  const raw     = await fetchSheetAsRecords(O2D_SOURCE_SHEET_ID, 'Sheet1');
  const results = [];

  for (const row of raw) {
    const norm = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.replace(/ /g, '_'), v])
    );

    const soDateStr = String(norm['SO_Date'] || '').trim();
    let planDateStr = '';
    if (soDateStr) {
      try {
        const soDate = new Date(soDateStr);
        soDate.setDate(soDate.getDate() + O2D_PLAN_DAYS);
        planDateStr  = soDate.toISOString().slice(0, 10);
      } catch (_) {}
    }

    results.push({
      'Timestamp':   norm['Timestamp']               || '',
      'SO_No':       String(norm['SO_No']       || '').trim(),
      'Client_Name': String(norm['Client_Name'] || '').trim(),
      'Product':     String(norm['Product']     || '').trim(),
      'Qty':         toFloat(norm['Qty']),
      'SO_Date':     soDateStr,
      'Plan_Date':   planDateStr,
      'Step':        String(norm['Step'] || 'Product Planning').trim(),
      'Agent_Name':  String(norm['Agent_Name']  || '').trim(),
      'Notes':       String(norm['Notes']       || '').trim(),
    });
  }

  return results;
}


// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD METRICS
// ══════════════════════════════════════════════════════════════════════════════

function computeDashboardMetrics(orders, pending, dispatch, stock, production, fms) {
  const pendingCustomers = new Set(
    pending.map(r => String(r['Company Name'] || '').trim()).filter(Boolean)
  ).size;

  const now = new Date();
  const lastUpdated =
    now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return {
    order_lines:        orders.length,
    total_qty_ordered:  orders.reduce((s, r) => s + toFloat(r['Qty']), 0),
    pending_lines:      pending.length,
    pending_bags:       pending.reduce((s, r) => s + toFloat(r['Pending Qty']), 0),
    pending_customers:  pendingCustomers,
    dispatched_lines:   dispatch.length,
    dispatched_bags:    dispatch.reduce((s, r) => s + toFloat(r['Qty']), 0),
    production_lines:   production.length,
    production_bags:    production.reduce((s, r) => s + toFloat(r['Qty'] || r['Pending Qty']), 0),
    stock_items:        stock.length,
    fms_advance_count:  fms.length,
    fms_advance_value:  fms.reduce((s, r) => s + toFloat(r['Total Bill']), 0),
    last_updated:       lastUpdated,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/erp-data', async (req, res) => {
  try {
    const [orders, pending, dispatch, dispfms, stock, production, fms, o2d] =
      await Promise.all([
        fetchSalesOrders(),
        fetchPendingOrders(),
        fetchDispatchOrders(),
        fetchDispatchFms(),
        fetchStockRegister(),
        fetchProductionRequirements(),
        fetchFmsAdvanceOrders(),
        fetchO2dPipeline(),
      ]);

    const metrics = computeDashboardMetrics(orders, pending, dispatch, stock, production, fms);

    res.json({ ok: true, metrics, orders, pending, dispatch, dispfms, stock, production, fms, o2d });
  } catch (err) {
    console.error('[/api/erp-data]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/orders',     async (req, res) => {
  try { res.json(await fetchSalesOrders());            } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/pending',    async (req, res) => {
  try { res.json(await fetchPendingOrders());          } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/dispatch',   async (req, res) => {
  try { res.json(await fetchDispatchOrders());         } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/dispfms',    async (req, res) => {
  try { res.json(await fetchDispatchFms());            } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/stock',      async (req, res) => {
  try { res.json(await fetchStockRegister());          } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/production', async (req, res) => {
  try { res.json(await fetchProductionRequirements()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/fms',        async (req, res) => {
  try { res.json(await fetchFmsAdvanceOrders());       } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/o2d',        async (req, res) => {
  try { res.json(await fetchO2dPipeline());            } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'TPPL ERP Sheets Fetcher (JS)', time: new Date().toISOString() });
});


// ══════════════════════════════════════════════════════════════════════════════
// WRITE / APPEND ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Collection FMS ────────────────────────────────────────────────────────────

// FIX: explicit tab names passed in all append calls (previously omitted, defaulting to
// 'Sheet1' inside appendEndpoint without validation — risked silent wrong-tab writes).

app.post('/api/append/call-later',     (req, res) =>
  appendEndpoint(req, res, CALL_LATER_SHEET_ID, CALL_LATER_TAB));

app.post('/api/append/done',           (req, res) =>
  appendEndpoint(req, res, DONE_SHEET_ID, DONE_TAB));

// ── O2D Pipeline ──────────────────────────────────────────────────────────────

app.post('/api/append/o2d-call-later', (req, res) =>
  appendEndpoint(req, res, O2D_CALL_LATER_ID, O2D_CALL_LATER_TAB));

app.post('/api/append/o2d-done',       (req, res) =>
  appendEndpoint(req, res, O2D_DONE_SHEET_ID, O2D_DONE_TAB));

// ── Dispatch FMS ──────────────────────────────────────────────────────────────

/**
 * POST /api/append/dispatch-hold
 * Body: { row: [logged_at, dispatch_date, party_name, invoice_no, item, qty, "HOLD", remark] }
 * Headers expected in sheet: Logged At | Dispatch Date | Party Name | Invoice No | Item | Qty | Status | Remark
 */
app.post('/api/append/dispatch-hold',  (req, res) =>
  appendEndpoint(req, res, DISPATCH_FMS_HOLD_SHEET_ID, DISPATCH_FMS_HOLD_TAB));

/**
 * POST /api/append/dispatch-done
 * Body: { row: [logged_at, dispatch_date, party_name, invoice_no, item, qty, "DONE"] }
 * Headers expected in sheet: Logged At | Dispatch Date | Party Name | Invoice No | Item | Qty | Status
 */
app.post('/api/append/dispatch-done',  (req, res) =>
  appendEndpoint(req, res, DISPATCH_FMS_DONE_SHEET_ID, DISPATCH_FMS_DONE_TAB));

// ── Rate Checklist (Apps Script proxy) ───────────────────────────────────────

app.post('/api/append/rate-checklist', async (req, res) => {
  const row = (req.body || {}).row || [];
  try {
    const response = await fetch(RATE_CL_SHEET_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'rate_checklist', data: row }),
    });
    if (!response.ok) throw new Error(`Apps Script returned ${response.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// CLI — CONNECTIVITY TEST  (node api_index.js --test)
// ══════════════════════════════════════════════════════════════════════════════

async function printSummary() {
  console.log('── TPPL ERP Google Sheets Connectivity Test ──');
  const checks = [
    ['Sales Orders          (order tab)',               fetchSalesOrders],
    ['Pending Orders        (pending sales tab)',       fetchPendingOrders],
    ['Dispatch              (Dispatch tab)',            fetchDispatchOrders],
    ['Dispatch FMS source   (New Dispatch fms sheet)',  fetchDispatchFms],
    ['Stock Register        (Stock tab)',               fetchStockRegister],
    ['Production Req.       (Production Req. tab)',     fetchProductionRequirements],
    ['FMS Advance Orders    (o2d tab, ADVANCE filter)', fetchFmsAdvanceOrders],
    ['O2D Pipeline          (Sheet1)',                  fetchO2dPipeline],
  ];
  for (const [name, fn] of checks) {
    try {
      const rows = await fn();
      console.log(`  ✅  ${name}: ${rows.length} rows`);
    } catch (err) {
      console.log(`  ❌  ${name}: ${err.message}`);
    }
  }
  console.log('── Done ──');
  console.log('');
  console.log('Tip: Check [fetchDispatchFms] header log above to verify column mapping.');
}


// ══════════════════════════════════════════════════════════════════════════════
// VERCEL EXPORT
// ══════════════════════════════════════════════════════════════════════════════

module.exports = app;

if (require.main === module) {
  if (process.argv.includes('--test')) {
    printSummary().then(() => process.exit(0));
  } else {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀  TPPL ERP Sheets API → http://localhost:${PORT}`);
      console.log('');
      console.log('  READ:');
      console.log('    GET  /api/erp-data              → All ERP data (single call)');
      console.log('    GET  /api/orders                → Sales orders');
      console.log('    GET  /api/pending               → Pending orders');
      console.log('    GET  /api/dispatch              → Dispatch register');
      console.log('    GET  /api/dispfms               → Dispatch FMS source');
      console.log('    GET  /api/stock                 → Stock register');
      console.log('    GET  /api/production            → Production requirements');
      console.log('    GET  /api/fms                   → Collection FMS advance orders');
      console.log('    GET  /api/o2d                   → O2D pipeline');
      console.log('    GET  /api/health                → Health check');
      console.log('');
      console.log('  WRITE:');
      console.log('    POST /api/append/call-later     → Collection FMS: call-later log');
      console.log('    POST /api/append/done           → Collection FMS: done log');
      console.log('    POST /api/append/o2d-call-later → O2D: call-later log');
      console.log('    POST /api/append/o2d-done       → O2D: done log');
      console.log('    POST /api/append/dispatch-hold  → Dispatch FMS: hold log');
      console.log('    POST /api/append/dispatch-done  → Dispatch FMS: done log');
      console.log('    POST /api/append/rate-checklist → Rate checklist (Apps Script)');
      console.log('');
      console.log('  Tip: node api_index.js --test  to check all connections.');
    });
  }
}
