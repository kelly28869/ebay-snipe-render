/**
 * eBaySnipe Server — Render Edition
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const {
  EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET,
  EBAY_ENV = 'production',
  PORT = 3001,
} = process.env;

const EBAY_AUTH_URL = EBAY_ENV === 'sandbox'
  ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
  : 'https://api.ebay.com/identity/v1/oauth2/token';

const EBAY_API_URL = EBAY_ENV === 'sandbox'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

// --- Session counter ---
let sessionCalls = 0;

// --- Real eBay usage (cached 60s) ---
let cachedEbayStats = null;
let lastStatsFetch = 0;

async function getRealUsage(token) {
  if (cachedEbayStats && Date.now() - lastStatsFetch < 60000) return cachedEbayStats;
  try {
    const res = await fetch(`${EBAY_API_URL}/developer/analytics/v1_beta/rate_limit/?api_name=buy.browse`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return cachedEbayStats;
    const data = await res.json();
    const rates = data.rateLimits?.[0]?.resources?.[0]?.rates?.[0];
    if (rates) {
      cachedEbayStats = { callsToday: rates.limit - rates.remaining, limit: rates.limit, remaining: rates.remaining };
      lastStatsFetch = Date.now();
    }
  } catch (e) {
    console.log('[Stats] eBay usage fetch failed:', e.message);
  }
  return cachedEbayStats;
}

function getApiStats(ebayStats) {
  if (ebayStats) return ebayStats;
  return { callsToday: sessionCalls, limit: 5000, remaining: 5000 - sessionCalls };
}

// --- OAuth ---
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(EBAY_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${credentials}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!response.ok) { const err = await response.text(); throw new Error(`OAuth failed: ${response.status} - ${err}`); }
  const data = await response.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) };
  console.log(`[Auth] Token refreshed, expires in ${data.expires_in}s`);
  return data.access_token;
}

// --- Filters ---
function buildFilterString({ minPrice, maxPrice, conditions, buyItNowOnly, freeShippingOnly }) {
  const f = [];
  if (buyItNowOnly) f.push('buyingOptions:{FIXED_PRICE}');
  if (minPrice && maxPrice) f.push(`price:[${minPrice}..${maxPrice}],priceCurrency:USD`);
  else if (minPrice) f.push(`price:[${minPrice}],priceCurrency:USD`);
  else if (maxPrice) f.push(`price:[..${maxPrice}],priceCurrency:USD`);
  if (conditions?.length) {
    const m = { 'New': '1000', 'Open Box': '1500', 'Refurbished': '2000', 'Used': '3000', 'For Parts': '7000' };
    const ids = conditions.map(c => m[c]).filter(Boolean);
    if (ids.length) f.push(`conditionIds:{${ids.join('|')}}`);
  }
  if (freeShippingOnly) f.push('maxDeliveryCost:0');
  f.push('deliveryCountry:US');
  return f.join(',');
}

// ============================================================
// ROUTES
// ============================================================

app.post('/api/search', async (req, res) => {
  try {
    const token = await getAccessToken();
    const {
      keywords = 'computer memory',
      minPrice, maxPrice, conditions = [],
      sortBy = 'newly_listed',
      buyItNowOnly = true, freeShippingOnly = false,
      zipCode = '08823', limit = 50, offset = 0,
    } = req.body;

    const url = new URL(`${EBAY_API_URL}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', keywords);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const filterStr = buildFilterString({ minPrice, maxPrice, conditions, buyItNowOnly, freeShippingOnly });
    if (filterStr) url.searchParams.set('filter', filterStr);
    const sortMap = { 'newly_listed': 'newlyListed', 'price_low': 'price', 'price_high': '-price', 'best_match': 'bestMatch' };
    url.searchParams.set('sort', sortMap[sortBy] || 'newlyListed');

    sessionCalls++;
    const ebayStats = await getRealUsage(token);
    const apiStats = getApiStats(ebayStats);
    console.log(`[Search] #${sessionCalls} | Used: ${apiStats.callsToday}/${apiStats.limit} | ${url}`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': `contextualLocation=country=US,zip=${zipCode}`,
      },
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `eBay API error: ${response.status}`, details: err });
    }

    const data = await response.json();
    const listings = (data.itemSummaries || []).map(item => {
      const shipOpt = item.shippingOptions?.[0];
      const shipType = shipOpt?.shippingCostType || '';
      const shipCostRaw = shipOpt?.shippingCost ? parseFloat(shipOpt.shippingCost.value) : null;
      const isFreeShipping = shipType === 'FIXED' && shipCostRaw === 0;
      const isCalculated = shipType === 'CALCULATED' || (shipCostRaw === 0 && shipType !== 'FIXED');

      let shipCost, shipping, shippingKnown;
      if (isFreeShipping) {
        shipCost = 0; shipping = 'Free shipping'; shippingKnown = true;
      } else if (isCalculated || shipCostRaw === null) {
        shipCost = null; shipping = 'Shipping TBD'; shippingKnown = false;
      } else {
        shipCost = shipCostRaw; shipping = `$${shipCostRaw.toFixed(2)} shipping`; shippingKnown = true;
      }

      const itemPrice = item.price ? parseFloat(item.price.value) : 0;
      const totalPrice = shippingKnown ? itemPrice + (shipCost || 0) : itemPrice;
      return {
        id: item.itemId, title: item.title,
        price: item.price ? `$${item.price.value}` : '', itemPrice,
        shipping, shipCost: shipCost || 0, totalPrice, shippingKnown,
        condition: item.condition || '', url: item.itemWebUrl || '',
        image: item.image?.imageUrl || '', seller: item.seller?.username || '',
        sellerRating: item.seller?.feedbackPercentage || '',
        location: item.itemLocation?.postalCode || '',
        listingDate: item.itemCreationDate || '',
      };
    });

    res.json({ total: data.total || 0, count: listings.length, listings, apiStats });
  } catch (err) {
    console.error('[Search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item/:itemId', async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`${EBAY_API_URL}/buy/browse/v1/item/${req.params.itemId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'X-EBAY-C-ENDUSERCTX': `contextualLocation=country=US,zip=${req.query.zip || '08823'}` },
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Item fetch failed' });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', async (req, res) => {
  try {
    const token = await getAccessToken();
    const ebayStats = await getRealUsage(token);
    res.json({ status: 'ok', env: EBAY_ENV, hasCredentials: !!(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET), apiStats: getApiStats(ebayStats) });
  } catch (e) {
    res.json({ status: 'ok', env: EBAY_ENV, hasCredentials: !!(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET), apiStats: getApiStats(null) });
  }
});

app.get('/api/rate-limit', async (req, res) => {
  try {
    const token = await getAccessToken();
    const ebayStats = await getRealUsage(token);
    res.json({ apiStats: getApiStats(ebayStats), session: sessionCalls, raw: cachedEbayStats });
  } catch (err) {
    res.json({ error: err.message, apiStats: getApiStats(null), session: sessionCalls });
  }
});

// --- Serve frontend ---
const clientDist = join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🟢 eBaySnipe running on http://localhost:${PORT}`);
  console.log(`   Environment: ${EBAY_ENV}\n`);
});
