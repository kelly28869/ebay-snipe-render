/**
 * eBaySnipe Server — Render Edition
 * 
 * In production, this serves BOTH the API and the React frontend
 * from a single Render web service (saves money, simpler).
 * 
 * Deploy to Render:
 *   1. Push to GitHub
 *   2. New Web Service → connect repo
 *   3. Root Directory: (leave blank, uses repo root)
 *   4. Build: npm run build
 *   5. Start: npm start
 *   6. Add env vars: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
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

// eBay API URLs
const EBAY_AUTH_URL = EBAY_ENV === 'sandbox'
  ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
  : 'https://api.ebay.com/identity/v1/oauth2/token';

const EBAY_API_URL = EBAY_ENV === 'sandbox'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

// Token cache
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(EBAY_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`eBay OAuth failed: ${response.status} - ${err}`);
  }

  const data = await response.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) };
  console.log(`[Auth] Token refreshed, expires in ${data.expires_in}s`);
  return data.access_token;
}

function buildFilterString({ minPrice, maxPrice, conditions, buyItNowOnly, freeShippingOnly }) {
  const filters = [];
  if (buyItNowOnly) filters.push('buyingOptions:{FIXED_PRICE}');
  if (minPrice && maxPrice) filters.push(`price:[${minPrice}..${maxPrice}],priceCurrency:USD`);
  else if (minPrice) filters.push(`price:[${minPrice}],priceCurrency:USD`);
  else if (maxPrice) filters.push(`price:[..${maxPrice}],priceCurrency:USD`);

  if (conditions?.length > 0) {
    const condMap = { 'New': '1000', 'Open Box': '1500', 'Refurbished': '2000', 'Used': '3000', 'For Parts': '7000' };
    const ids = conditions.map(c => condMap[c]).filter(Boolean);
    if (ids.length) filters.push(`conditionIds:{${ids.join('|')}}`);
  }

  if (freeShippingOnly) filters.push('maxDeliveryCost:0');
  filters.push('deliveryCountry:US');
  return filters.join(',');
}

// ============================================================
// API Routes
// ============================================================

app.post('/api/search', async (req, res) => {
  try {
    const token = await getAccessToken();
    const {
      keywords = 'computer memory',
      minPrice, maxPrice, conditions = [],
      sortBy = 'newly_listed',
      buyItNowOnly = true, freeShippingOnly = false,
      zipCode = '08823', limit = 20, offset = 0,
    } = req.body;

    const url = new URL(`${EBAY_API_URL}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', keywords);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const filterStr = buildFilterString({ minPrice, maxPrice, conditions, buyItNowOnly, freeShippingOnly });
    if (filterStr) url.searchParams.set('filter', filterStr);

    const sortMap = { 'newly_listed': 'newlyListed', 'price_low': 'price', 'price_high': '-price', 'best_match': 'bestMatch' };
    url.searchParams.set('sort', sortMap[sortBy] || 'newlyListed');

    console.log(`[Search] ${url}`);

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
      const shipCost = item.shippingOptions?.[0]?.shippingCost
        ? parseFloat(item.shippingOptions[0].shippingCost.value) : 0;
      const itemPrice = item.price ? parseFloat(item.price.value) : 0;
      return {
        id: item.itemId,
        title: item.title,
        price: item.price ? `$${item.price.value}` : '',
        itemPrice,
        shipping: shipCost === 0 ? 'Free shipping' : `$${shipCost.toFixed(2)} shipping`,
        shipCost,
        totalPrice: itemPrice + shipCost,
        condition: item.condition || '',
        url: item.itemWebUrl || '',
        image: item.image?.imageUrl || '',
        seller: item.seller?.username || '',
        sellerRating: item.seller?.feedbackPercentage || '',
        location: item.itemLocation?.postalCode || '',
        listingDate: item.itemCreationDate || '',
      };
    });

    res.json({ total: data.total || 0, count: listings.length, listings });
  } catch (err) {
    console.error('[Search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item/:itemId', async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`${EBAY_API_URL}/buy/browse/v1/item/${req.params.itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': `contextualLocation=country=US,zip=${req.query.zip || '08823'}`,
      },
    });
    if (!response.ok) return res.status(response.status).json({ error: `Item fetch failed` });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: EBAY_ENV, hasCredentials: !!(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET) });
});

// ============================================================
// Serve React frontend in production
// ============================================================
const clientDist = join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🟢 eBaySnipe running on http://localhost:${PORT}`);
  console.log(`   Environment: ${EBAY_ENV}`);
  console.log(`   Serving frontend from: ${clientDist}\n`);
});
