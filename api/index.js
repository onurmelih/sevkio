require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, ensureSchema } = require('../lib/db');
const trendyol = require('../lib/trendyol');
const n11 = require('../lib/n11');

const JWT_SECRET = process.env.JWT_SECRET || 'demo-gelistirme-anahtari-PRODUCTIONDA-DEGISTIR';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Sunucusuz ortamda her "soğuk başlangıç"ta bir kere şema kontrolü yapılır (IF NOT EXISTS -> ucuz).
let schemaReady = null;
app.use(async (req, res, next) => {
  try {
    if (!schemaReady) schemaReady = ensureSchema();
    await schemaReady;
    next();
  } catch (err) {
    console.error('Şema hatası:', err);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı' });
  }
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.companyId = payload.companyId;
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Geçersiz oturum' });
  }
}

// Gerçek Trendyol bağlantısı varsa gerçek API çağrısı yapar; diğer pazaryerleri için
// (henüz entegre edilmedikleri için) mock log'a yazar.
async function pushStockToMarketplaces(companyId, productId, newStock) {
  const { rows: [product] } = await query(
    `SELECT sku, barcode FROM products WHERE id=$1 AND company_id=$2`, [productId, companyId]
  );
  let pushed = 0;

  const { rows: connRows } = await query(
    `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace IN ('trendyol','n11') AND is_active=1`,
    [companyId]
  );
  const trendyolConn = connRows.find(c => c.marketplace === 'trendyol');
  const n11Conn = connRows.find(c => c.marketplace === 'n11');

  if (trendyolConn && product?.barcode) {
    try {
      await trendyol.updateStock(trendyolConn, [{ barcode: product.barcode, quantity: newStock }]);
      console.log(`[TRENDYOL-GERÇEK] barkod ${product.barcode} stok = ${newStock}`);
      pushed++;
    } catch (err) {
      console.error('Trendyol stok güncelleme hatası:', err.message, err.data || '');
    }
  }

  if (n11Conn && product?.sku) {
    try {
      await n11.updateStock(n11Conn, [{ stockCode: product.sku, quantity: newStock }]);
      console.log(`[N11-GERÇEK] stockCode ${product.sku} stok = ${newStock}`);
      pushed++;
    } catch (err) {
      console.error('N11 stok güncelleme hatası:', err.message, err.data || '');
    }
  }

  const { rows: mappings } = await query(
    `SELECT marketplace, marketplace_product_id FROM marketplace_mappings
     WHERE company_id=$1 AND product_id=$2 AND marketplace NOT IN ('trendyol','n11')`,
    [companyId, productId]
  );
  for (const m of mappings) {
    // TODO: gerçek API çağrısı burada olacak (Hepsiburada/Amazon/ÇiçekSepeti)
    console.log(`[MOCK] ${m.marketplace} -> ürün ${m.marketplace_product_id} stok = ${newStock}`);
    pushed++;
  }
  return pushed;
}

// ---------- Auth ----------

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }
  const token = jwt.sign({ companyId: user.company_id, userId: user.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, name: user.name, role: user.role });
});

// ---------- Barkod okuma ----------

app.get('/api/scan/:barcode', authMiddleware, async (req, res) => {
  const { rows: orderRows } = await query(
    `SELECT * FROM orders WHERE company_id = $1 AND cargo_barcode = $2`,
    [req.companyId, req.params.barcode]
  );
  const order = orderRows[0];
  if (!order) return res.status(404).json({ error: 'Bu barkoda ait sipariş bulunamadı' });

  const { rows: items } = await query(
    `SELECT oi.quantity, p.name, p.sku, p.stock
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [order.id]
  );

  res.json({ order, items });
});

// ---------- Siparişi kargoya ver -> stok düş + tüm pazaryerlerine yay ----------

app.post('/api/orders/:id/ship', authMiddleware, async (req, res) => {
  const { rows: orderRows } = await query(
    `SELECT * FROM orders WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  const order = orderRows[0];
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  if (order.status !== 'yeni' && order.status !== 'hazirlaniyor') {
    return res.status(400).json({ error: `Bu sipariş zaten "${order.status}" durumunda` });
  }

  const { rows: items } = await query(`SELECT * FROM order_items WHERE order_id = $1`, [order.id]);

  const client = await require('../lib/db').pool.connect();
  const updatedStocks = [];
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const { rows: prodRows } = await client.query(`SELECT * FROM products WHERE id = $1`, [item.product_id]);
      const product = prodRows[0];
      const newStock = Math.max(0, product.stock - item.quantity);
      await client.query(`UPDATE products SET stock = $1 WHERE id = $2`, [newStock, product.id]);
      await client.query(
        `INSERT INTO stock_log (company_id, product_id, change, reason, order_id) VALUES ($1,$2,$3,'siparis',$4)`,
        [req.companyId, product.id, -item.quantity, order.id]
      );
      updatedStocks.push({ productId: product.id, newStock });
    }
    await client.query(`UPDATE orders SET status = 'kargoda', billed = 1 WHERE id = $1`, [order.id]);

    const period = new Date().toISOString().slice(0, 7);
    await client.query(`
      INSERT INTO billing_usage (company_id, period, order_count) VALUES ($1, $2, 1)
      ON CONFLICT (company_id, period) DO UPDATE SET order_count = billing_usage.order_count + 1
    `, [req.companyId, period]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Kargoya verme işlemi başarısız oldu' });
  } finally {
    client.release();
  }

  let pushedTo = 0;
  for (const u of updatedStocks) {
    pushedTo += await pushStockToMarketplaces(req.companyId, u.productId, u.newStock);
  }

  let trendyolPackageUpdate = null;
  if (order.marketplace === 'trendyol' && order.marketplace_package_id) {
    const { rows: connRows2 } = await query(
      `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='trendyol' AND is_active=1`,
      [req.companyId]
    );
    if (connRows2[0]) {
      try {
        await trendyol.markPicking(connRows2[0], order.marketplace_package_id);
        trendyolPackageUpdate = 'basarili';
      } catch (err) {
        console.error('Trendyol paket statü hatası:', err.message, err.data || '');
        trendyolPackageUpdate = 'hata';
      }
    }
  }

  let n11PackageUpdate = null;
  if (order.marketplace === 'n11') {
    const lineIds = items.map(i => i.marketplace_line_id).filter(Boolean);
    if (lineIds.length) {
      const { rows: connRows3 } = await query(
        `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='n11' AND is_active=1`,
        [req.companyId]
      );
      if (connRows3[0]) {
        try {
          await n11.markPicking(connRows3[0], lineIds);
          n11PackageUpdate = 'basarili';
        } catch (err) {
          console.error('N11 paket statü hatası:', err.message, err.data || '');
          n11PackageUpdate = 'hata';
        }
      }
    }
  }

  res.json({ ok: true, status: 'kargoda', marketplacesUpdated: pushedTo, trendyolPackageUpdate, n11PackageUpdate });
});

// ---------- Pazaryeri bağlantı bilgileri (arkadaşının gerçek Trendyol hesabı) ----------

app.post('/api/marketplace-connections', authMiddleware, async (req, res) => {
  const { marketplace, sellerId, apiKey, apiSecret, environment } = req.body;
  if (!marketplace || !sellerId) {
    return res.status(400).json({ error: 'marketplace ve sellerId zorunlu' });
  }
  const { rows: existingRows } = await query(
    `SELECT api_key, api_secret FROM marketplace_connections WHERE company_id=$1 AND marketplace=$2`,
    [req.companyId, marketplace]
  );
  const existing = existingRows[0];
  const finalApiKey = apiKey || existing?.api_key;
  const finalApiSecret = apiSecret || existing?.api_secret;
  if (!finalApiKey || !finalApiSecret) {
    return res.status(400).json({ error: 'apiKey ve apiSecret zorunlu (ilk bağlantıda boş bırakılamaz)' });
  }
  await query(`
    INSERT INTO marketplace_connections (company_id, marketplace, seller_id, api_key, api_secret, environment, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,1)
    ON CONFLICT (company_id, marketplace) DO UPDATE SET
      seller_id = EXCLUDED.seller_id, api_key = EXCLUDED.api_key,
      api_secret = EXCLUDED.api_secret, environment = EXCLUDED.environment, is_active = 1
  `, [req.companyId, marketplace, String(sellerId), finalApiKey, finalApiSecret, environment || 'prod']);
  res.json({ ok: true });
});

app.get('/api/marketplace-connections', authMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT marketplace, seller_id, environment, is_active FROM marketplace_connections WHERE company_id=$1`,
    [req.companyId]
  );
  res.json(rows);
});

app.patch('/api/marketplace-connections/:marketplace/toggle', authMiddleware, async (req, res) => {
  const { rows } = await query(
    `UPDATE marketplace_connections SET is_active = 1 - is_active
     WHERE company_id=$1 AND marketplace=$2 RETURNING marketplace, is_active`,
    [req.companyId, req.params.marketplace]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
  res.json(rows[0]);
});

// ---------- Trendyol'dan gerçek siparişleri çek ----------

app.post('/api/sync/trendyol', authMiddleware, async (req, res) => {
  const { rows: connRows } = await query(
    `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='trendyol' AND is_active=1`,
    [req.companyId]
  );
  const conn = connRows[0];
  if (!conn) {
    return res.status(400).json({ error: 'Önce POST /api/marketplace-connections ile Trendyol bilgilerini kaydet' });
  }

  const endDate = Date.now();
  const startDate = endDate - 14 * 24 * 60 * 60 * 1000; // son 14 gün

  let data;
  try {
    data = await trendyol.getOrders(conn, { startDate, endDate, page: 0, size: 50 });
  } catch (err) {
    console.error('Trendyol sipariş çekme hatası:', err.message, err.data || '');
    return res.status(502).json({ error: 'Trendyol siparişleri çekilemedi: ' + err.message, detail: err.data });
  }

  const packages = data?.content || [];
  const statusMap = {
    Created: 'yeni', Picking: 'yeni', Invoiced: 'kargoda', Shipped: 'kargoda',
    Delivered: 'teslim', Cancelled: 'iptal', UnDelivered: 'kargoda', Returned: 'iptal',
  };

  let created = 0, updated = 0;

  for (const pkg of packages) {
    const cargoBarcode = pkg.cargoTrackingNumber || pkg.shipmentNumber || String(pkg.id);
    const localStatus = statusMap[pkg.status] || 'yeni';
    const customerName = [pkg.customerFirstName, pkg.customerLastName].filter(Boolean).join(' ');
    const customerAddress = pkg.shipmentAddress?.fullAddress ||
      [pkg.shipmentAddress?.address1, pkg.shipmentAddress?.district, pkg.shipmentAddress?.city]
        .filter(Boolean).join(' / ');

    const { rows: existingRows } = await query(
      `SELECT id FROM orders WHERE company_id=$1 AND cargo_barcode=$2`, [req.companyId, cargoBarcode]
    );

    if (existingRows[0]) {
      await query(
        `UPDATE orders SET status=$1, marketplace_package_id=$2 WHERE id=$3`,
        [localStatus, String(pkg.id), existingRows[0].id]
      );
      updated++;
      continue;
    }

    const { rows: [newOrder] } = await query(`
      INSERT INTO orders (company_id, marketplace, marketplace_order_no, cargo_barcode, customer_name, customer_address, status, marketplace_package_id)
      VALUES ($1,'trendyol',$2,$3,$4,$5,$6,$7) RETURNING id
    `, [req.companyId, pkg.orderNumber, cargoBarcode, customerName, customerAddress, localStatus, String(pkg.id)]);
    created++;

    for (const line of (pkg.lines || [])) {
      if (!line.barcode) continue;
      const { rows: prodRows } = await query(
        `SELECT id FROM products WHERE company_id=$1 AND barcode=$2`, [req.companyId, line.barcode]
      );
      let productId;
      if (prodRows[0]) {
        productId = prodRows[0].id;
      } else {
        // Ürün sistemimizde kayıtlı değilse Trendyol'dan gelen bilgiyle otomatik oluşturulur
        // (stok 0 varsayılan olarak başlar, gerçek stok elle/panelden düzeltilmeli).
        const sku = line.merchantSku || line.productSellerCode || line.barcode;
        const { rows: [newProduct] } = await query(`
          INSERT INTO products (company_id, sku, name, barcode, stock) VALUES ($1,$2,$3,$4,0)
          ON CONFLICT (company_id, sku) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [req.companyId, sku, line.productName || sku, line.barcode]);
        productId = newProduct.id;
      }
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1,$2,$3)`,
        [newOrder.id, productId, line.quantity || 1]
      );
    }
  }

  res.json({ ok: true, created, updated, totalFromTrendyol: packages.length });
});

// ---------- N11'den gerçek siparişleri çek ----------

app.post('/api/sync/n11', authMiddleware, async (req, res) => {
  const { rows: connRows } = await query(
    `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='n11' AND is_active=1`,
    [req.companyId]
  );
  const conn = connRows[0];
  if (!conn) {
    return res.status(400).json({ error: 'Önce POST /api/marketplace-connections ile N11 bilgilerini kaydet' });
  }

  const endDate = Date.now();
  const startDate = endDate - 14 * 24 * 60 * 60 * 1000;

  let data;
  try {
    data = await n11.getOrders(conn, { startDate, endDate, page: 0, size: 100 });
  } catch (err) {
    console.error('N11 sipariş çekme hatası:', err.message, err.data || '');
    return res.status(502).json({ error: 'N11 siparişleri çekilemedi: ' + err.message, detail: err.data });
  }

  const packages = data?.content || [];
  const statusMap = {
    Created: 'yeni', Picking: 'yeni', Shipped: 'kargoda',
    Delivered: 'teslim', Cancelled: 'iptal', Unpacked: 'yeni', UnSupplied: 'iptal',
  };

  let created = 0, updated = 0;

  for (const pkg of packages) {
    const cargoBarcode = pkg.cargoTrackingNumber || String(pkg.id);
    const localStatus = statusMap[pkg.shipmentPackageStatus] || 'yeni';
    const customerAddress = pkg.shippingAddress?.address ||
      [pkg.shippingAddress?.district, pkg.shippingAddress?.city].filter(Boolean).join(' / ');

    const { rows: existingRows } = await query(
      `SELECT id FROM orders WHERE company_id=$1 AND cargo_barcode=$2`, [req.companyId, cargoBarcode]
    );

    if (existingRows[0]) {
      await query(
        `UPDATE orders SET status=$1, marketplace_package_id=$2 WHERE id=$3`,
        [localStatus, String(pkg.id), existingRows[0].id]
      );
      updated++;
      continue;
    }

    const { rows: [newOrder] } = await query(`
      INSERT INTO orders (company_id, marketplace, marketplace_order_no, cargo_barcode, customer_name, customer_address, status, marketplace_package_id)
      VALUES ($1,'n11',$2,$3,$4,$5,$6,$7) RETURNING id
    `, [req.companyId, pkg.orderNumber, cargoBarcode, pkg.customerfullName, customerAddress, localStatus, String(pkg.id)]);
    created++;

    for (const line of (pkg.lines || [])) {
      const barcode = line.barcode || null;
      let productId = null;
      if (barcode) {
        const { rows: prodRows } = await query(
          `SELECT id FROM products WHERE company_id=$1 AND barcode=$2`, [req.companyId, barcode]
        );
        if (prodRows[0]) productId = prodRows[0].id;
      }
      if (!productId) {
        const sku = line.stockCode || barcode || `n11-${line.productId}`;
        const { rows: prodBySku } = await query(
          `SELECT id FROM products WHERE company_id=$1 AND sku=$2`, [req.companyId, sku]
        );
        if (prodBySku[0]) {
          productId = prodBySku[0].id;
        } else {
          const { rows: [newProduct] } = await query(`
            INSERT INTO products (company_id, sku, name, barcode, stock) VALUES ($1,$2,$3,$4,0)
            ON CONFLICT (company_id, sku) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `, [req.companyId, sku, line.productName || sku, barcode]);
          productId = newProduct.id;
        }
      }
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity, marketplace_line_id) VALUES ($1,$2,$3,$4)`,
        [newOrder.id, productId, line.quantity || 1, String(line.orderLineId || '')]
      );
    }
  }

  res.json({ ok: true, created, updated, totalFromN11: packages.length });
});

// ---------- Ürün/stok listesi ----------

app.get('/api/products', authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT * FROM products WHERE company_id = $1 ORDER BY name`, [req.companyId]);
  res.json(rows);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Vercel bu dosyayı bir sunucusuz fonksiyon olarak çalıştırır (app bir request handler'dır).
module.exports = app;

// Yerelde `node api/index.js` ile de doğrudan çalıştırılabilir (npm start bunu kullanır).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Backend http://localhost:${PORT} üzerinde çalışıyor`));
}
