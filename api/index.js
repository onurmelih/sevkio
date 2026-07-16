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
    if (!schemaReady) schemaReady = ensureSchema().then(bootstrapSuperAdmin);
    await schemaReady;
    next();
  } catch (err) {
    console.error('Şema hatası:', err);
    res.status(500).json({ error: 'Veritabanına bağlanılamadı' });
  }
});

// SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD ortam değişkenleri tanımlıysa ve o e-posta
// henüz kayıtlı değilse, ilk süper admin hesabını otomatik oluşturur. Bu sayede Vercel'e
// deploy ettiğinde elle bir script çalıştırmana gerek kalmaz.
async function bootstrapSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) return;
  const { rows } = await query(`SELECT id FROM super_admins WHERE email=$1`, [email]);
  if (rows[0]) return;
  await query(
    `INSERT INTO super_admins (name, email, password_hash) VALUES ($1,$2,$3)`,
    ['Süper Admin', email, bcrypt.hashSync(password, 8)]
  );
  console.log('Süper admin hesabı oluşturuldu:', email);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'company_user') return res.status(401).json({ error: 'Geçersiz oturum' });
    req.companyId = payload.companyId;
    req.userId = payload.userId;
    req.role = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Geçersiz oturum' });
  }
}

// Sadece belirli rollerin erişebileceği endpoint'ler için (örnek: depo çalışanı pazaryeri
// bağlantılarını göremez/değiştiremez, sadece yönetici görür).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkin yok' });
    }
    next();
  };
}

// Süper admin: firmalardan tamamen ayrı, kendi token tipiyle çalışır.
function superAdminMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'super_admin') return res.status(401).json({ error: 'Geçersiz oturum' });
    req.superAdminId = payload.superAdminId;
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
  const { rows } = await query(`
    SELECT u.*, c.plan_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1
  `, [email]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }
  if (user.plan_status === 'dondurulmus') {
    return res.status(403).json({ error: 'Firma hesabı dondurulmuş. Yönetici ile iletişime geç.' });
  }
  const token = jwt.sign(
    { type: 'company_user', companyId: user.company_id, userId: user.id, role: user.role },
    JWT_SECRET, { expiresIn: '12h' }
  );
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

app.post('/api/marketplace-connections', authMiddleware, requireRole('yonetici'), async (req, res) => {
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

app.get('/api/marketplace-connections', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows } = await query(
    `SELECT marketplace, seller_id, environment, is_active FROM marketplace_connections WHERE company_id=$1`,
    [req.companyId]
  );
  res.json(rows);
});

app.patch('/api/marketplace-connections/:marketplace/toggle', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows } = await query(
    `UPDATE marketplace_connections SET is_active = 1 - is_active
     WHERE company_id=$1 AND marketplace=$2 RETURNING marketplace, is_active`,
    [req.companyId, req.params.marketplace]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
  res.json(rows[0]);
});

// ---------- Firma çalışanları (sadece yönetici ekleyip görebilir) ----------

app.get('/api/users', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, created_at FROM users WHERE company_id=$1 ORDER BY created_at`,
    [req.companyId]
  );
  res.json(rows);
});

app.post('/api/users', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password zorunlu' });
  }
  if (!['depo', 'yonetici'].includes(role)) {
    return res.status(400).json({ error: 'role "depo" ya da "yonetici" olmalı' });
  }
  const { rows: existing } = await query(`SELECT id FROM users WHERE email=$1`, [email]);
  if (existing[0]) return res.status(409).json({ error: 'Bu e-posta zaten kullanılıyor' });

  const { rows: [user] } = await query(`
    INSERT INTO users (company_id, name, email, password_hash, role)
    VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role
  `, [req.companyId, name, email, bcrypt.hashSync(password, 8), role]);
  res.json({ ok: true, user });
});

app.delete('/api/users/:id', authMiddleware, requireRole('yonetici'), async (req, res) => {
  if (Number(req.params.id) === req.userId) {
    return res.status(400).json({ error: 'Kendi hesabını silemezsin' });
  }
  const { rows } = await query(
    `DELETE FROM users WHERE id=$1 AND company_id=$2 RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json({ ok: true });
});

// E-posta ile şifre sıfırlama servisimiz yok (henüz mail gönderme altyapısı kurulmadı),
// bu yüzden yönetici kendi firmasındaki (ya da kendi) şifresini burada elle sıfırlayabilir.
app.patch('/api/users/:id/reset-password', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });
  }
  const { rows } = await query(
    `UPDATE users SET password_hash=$1 WHERE id=$2 AND company_id=$3 RETURNING id, name, email`,
    [bcrypt.hashSync(newPassword, 8), req.params.id, req.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json({ ok: true, user: rows[0] });
});

// ---------- Trendyol'dan gerçek siparişleri çek ----------

// Trendyol/N11 senkron mantığı hem elle tetiklenen /api/sync/* endpoint'lerinden
// hem de otomatik çalışan cron endpoint'inden (aşağıda) çağrılabilsin diye ayrı fonksiyonlar.

async function syncTrendyolForCompany(companyId, conn) {
  const endDate = Date.now();
  const startDate = endDate - 14 * 24 * 60 * 60 * 1000;
  const data = await trendyol.getOrders(conn, { startDate, endDate, page: 0, size: 50 });

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
      `SELECT id FROM orders WHERE company_id=$1 AND cargo_barcode=$2`, [companyId, cargoBarcode]
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
    `, [companyId, pkg.orderNumber, cargoBarcode, customerName, customerAddress, localStatus, String(pkg.id)]);
    created++;

    for (const line of (pkg.lines || [])) {
      if (!line.barcode) continue;
      const { rows: prodRows } = await query(
        `SELECT id FROM products WHERE company_id=$1 AND barcode=$2`, [companyId, line.barcode]
      );
      let productId;
      if (prodRows[0]) {
        productId = prodRows[0].id;
      } else {
        const sku = line.merchantSku || line.productSellerCode || line.barcode;
        const { rows: [newProduct] } = await query(`
          INSERT INTO products (company_id, sku, name, barcode, stock) VALUES ($1,$2,$3,$4,0)
          ON CONFLICT (company_id, sku) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [companyId, sku, line.productName || sku, line.barcode]);
        productId = newProduct.id;
      }
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1,$2,$3)`,
        [newOrder.id, productId, line.quantity || 1]
      );
    }
  }

  return { created, updated, total: packages.length };
}

async function syncN11ForCompany(companyId, conn) {
  const endDate = Date.now();
  const startDate = endDate - 14 * 24 * 60 * 60 * 1000;
  const data = await n11.getOrders(conn, { startDate, endDate, page: 0, size: 100 });

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
      `SELECT id FROM orders WHERE company_id=$1 AND cargo_barcode=$2`, [companyId, cargoBarcode]
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
    `, [companyId, pkg.orderNumber, cargoBarcode, pkg.customerfullName, customerAddress, localStatus, String(pkg.id)]);
    created++;

    for (const line of (pkg.lines || [])) {
      const barcode = line.barcode || null;
      let productId = null;
      if (barcode) {
        const { rows: prodRows } = await query(
          `SELECT id FROM products WHERE company_id=$1 AND barcode=$2`, [companyId, barcode]
        );
        if (prodRows[0]) productId = prodRows[0].id;
      }
      if (!productId) {
        const sku = line.stockCode || barcode || `n11-${line.productId}`;
        const { rows: prodBySku } = await query(
          `SELECT id FROM products WHERE company_id=$1 AND sku=$2`, [companyId, sku]
        );
        if (prodBySku[0]) {
          productId = prodBySku[0].id;
        } else {
          const { rows: [newProduct] } = await query(`
            INSERT INTO products (company_id, sku, name, barcode, stock) VALUES ($1,$2,$3,$4,0)
            ON CONFLICT (company_id, sku) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `, [companyId, sku, line.productName || sku, barcode]);
          productId = newProduct.id;
        }
      }
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity, marketplace_line_id) VALUES ($1,$2,$3,$4)`,
        [newOrder.id, productId, line.quantity || 1, String(line.orderLineId || '')]
      );
    }
  }

  return { created, updated, total: packages.length };
}

app.post('/api/sync/trendyol', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows: connRows } = await query(
    `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='trendyol' AND is_active=1`,
    [req.companyId]
  );
  const conn = connRows[0];
  if (!conn) {
    return res.status(400).json({ error: 'Önce POST /api/marketplace-connections ile Trendyol bilgilerini kaydet' });
  }
  try {
    const result = await syncTrendyolForCompany(req.companyId, conn);
    res.json({ ok: true, created: result.created, updated: result.updated, totalFromTrendyol: result.total });
  } catch (err) {
    console.error('Trendyol sipariş çekme hatası:', err.message, err.data || '');
    res.status(502).json({ error: 'Trendyol siparişleri çekilemedi: ' + err.message, detail: err.data });
  }
});

// ---------- N11'den gerçek siparişleri çek ----------

app.post('/api/sync/n11', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows: connRows } = await query(
    `SELECT * FROM marketplace_connections WHERE company_id=$1 AND marketplace='n11' AND is_active=1`,
    [req.companyId]
  );
  const conn = connRows[0];
  if (!conn) {
    return res.status(400).json({ error: 'Önce POST /api/marketplace-connections ile N11 bilgilerini kaydet' });
  }
  try {
    const result = await syncN11ForCompany(req.companyId, conn);
    res.json({ ok: true, created: result.created, updated: result.updated, totalFromN11: result.total });
  } catch (err) {
    console.error('N11 sipariş çekme hatası:', err.message, err.data || '');
    res.status(502).json({ error: 'N11 siparişleri çekilemedi: ' + err.message, detail: err.data });
  }
});

// ---------- Otomatik senkron (Vercel Cron ile 6 saatte bir tetiklenir) ----------
// Vercel, CRON_SECRET ortam değişkeni tanımlıysa bunu otomatik olarak Authorization
// header'ına ekler. Bu sayede sadece Vercel'in kendisi bu endpoint'i çalıştırabilir.

app.get('/api/cron/sync-all', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { rows: connections } = await query(
    `SELECT * FROM marketplace_connections WHERE is_active=1 AND marketplace IN ('trendyol','n11')`
  );

  const results = [];
  for (const conn of connections) {
    try {
      const result = conn.marketplace === 'trendyol'
        ? await syncTrendyolForCompany(conn.company_id, conn)
        : await syncN11ForCompany(conn.company_id, conn);
      results.push({ companyId: conn.company_id, marketplace: conn.marketplace, ...result });
    } catch (err) {
      console.error(`Cron senkron hatası (firma ${conn.company_id}, ${conn.marketplace}):`, err.message);
      results.push({ companyId: conn.company_id, marketplace: conn.marketplace, error: err.message });
    }
  }

  res.json({ ok: true, checkedConnections: connections.length, results });
});

app.get('/api/products/by-barcode/:barcode', authMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT id, sku, name, stock FROM products WHERE company_id=$1 AND barcode=$2`,
    [req.companyId, req.params.barcode]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Bu barkodla eşleşen ürün bulunamadı' });
  res.json(rows[0]);
});

// ---------- İade Yönetimi ----------

// Depo çalışanı ya da yönetici bir iade bildirir (stok henüz değişmez, onay bekler).
app.post('/api/returns', authMiddleware, async (req, res) => {
  const { orderId, productId, quantity, reason } = req.body;
  if (!productId || !quantity) return res.status(400).json({ error: 'productId ve quantity zorunlu' });

  const { rows: prodRows } = await query(
    `SELECT id FROM products WHERE id=$1 AND company_id=$2`, [productId, req.companyId]
  );
  if (!prodRows[0]) return res.status(404).json({ error: 'Ürün bulunamadı' });

  const { rows: [ret] } = await query(`
    INSERT INTO returns (company_id, order_id, product_id, quantity, reason, requested_by)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [req.companyId, orderId || null, productId, quantity, reason || null, req.userId]);
  res.json({ ok: true, return: ret });
});

app.get('/api/returns', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows } = await query(`
    SELECT r.*, p.name AS product_name, p.sku, u.name AS requested_by_name
    FROM returns r
    JOIN products p ON p.id = r.product_id
    LEFT JOIN users u ON u.id = r.requested_by
    WHERE r.company_id = $1 ORDER BY r.created_at DESC
  `, [req.companyId]);
  res.json(rows);
});

app.patch('/api/returns/:id/approve', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows: retRows } = await query(
    `SELECT * FROM returns WHERE id=$1 AND company_id=$2`, [req.params.id, req.companyId]
  );
  const ret = retRows[0];
  if (!ret) return res.status(404).json({ error: 'İade kaydı bulunamadı' });
  if (ret.status !== 'bekliyor') return res.status(400).json({ error: 'Bu iade zaten işlendi' });

  const { rows: [product] } = await query(`SELECT * FROM products WHERE id=$1`, [ret.product_id]);
  const newStock = product.stock + ret.quantity;

  await query(`UPDATE products SET stock=$1 WHERE id=$2`, [newStock, product.id]);
  await query(`
    INSERT INTO stock_log (company_id, product_id, change, reason, order_id) VALUES ($1,$2,$3,'iade',$4)
  `, [req.companyId, product.id, ret.quantity, ret.order_id]);
  await query(`
    UPDATE returns SET status='onaylandi', approved_by=$1, resolved_at=now() WHERE id=$2
  `, [req.userId, ret.id]);

  const pushed = await pushStockToMarketplaces(req.companyId, product.id, newStock);
  res.json({ ok: true, newStock, marketplacesUpdated: pushed });
});

app.patch('/api/returns/:id/reject', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { rows } = await query(`
    UPDATE returns SET status='reddedildi', approved_by=$1, resolved_at=now()
    WHERE id=$2 AND company_id=$3 AND status='bekliyor' RETURNING *
  `, [req.userId, req.params.id, req.companyId]);
  if (!rows[0]) return res.status(404).json({ error: 'İade kaydı bulunamadı ya da zaten işlendi' });
  res.json({ ok: true });
});

// ---------- Sipariş Listesi (yönetici paneli için genel görünüm) ----------

app.get('/api/orders', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { status, marketplace, limit } = req.query;
  const conditions = ['company_id = $1'];
  const params = [req.companyId];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (marketplace) { params.push(marketplace); conditions.push(`marketplace = $${params.length}`); }
  params.push(Math.min(parseInt(limit, 10) || 100, 300));

  const { rows } = await query(`
    SELECT o.*, COALESCE(SUM(oi.quantity), 0) AS item_count
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT $${params.length}
  `, params);
  res.json(rows);
});

// ---------- Ürün/stok listesi ----------

app.get('/api/products', authMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT *, (low_stock_alert_enabled AND stock <= COALESCE(low_stock_threshold, 0)) AS is_low_stock
    FROM products WHERE company_id = $1 ORDER BY name
  `, [req.companyId]);
  res.json(rows);
});

app.post('/api/products', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { sku, name, barcode, stock, category, price, vatRate, lowStockThreshold, lowStockAlertEnabled, variantGroup, variantLabel } = req.body;
  if (!sku || !name) return res.status(400).json({ error: 'sku ve name zorunlu' });
  try {
    const { rows: [product] } = await query(`
      INSERT INTO products (company_id, sku, name, barcode, stock, category, price, vat_rate, low_stock_threshold, low_stock_alert_enabled, variant_group, variant_label)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [req.companyId, sku, name, barcode || null, stock || 0, category || null, price || null,
        vatRate ?? 20, lowStockThreshold || null, !!lowStockAlertEnabled, variantGroup || null, variantLabel || null]);
    res.json({ ok: true, product });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu SKU ya da barkod zaten kullanılıyor' });
    console.error(err);
    res.status(500).json({ error: 'Ürün eklenemedi' });
  }
});

app.patch('/api/products/:id', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { name, barcode, stock, category, price, vatRate, lowStockThreshold, lowStockAlertEnabled, variantGroup, variantLabel } = req.body;
  try {
    const { rows } = await query(`
      UPDATE products SET
        name = COALESCE($1, name),
        barcode = $2,
        stock = COALESCE($3, stock),
        category = $4,
        price = $5,
        vat_rate = COALESCE($6, vat_rate),
        low_stock_threshold = $7,
        low_stock_alert_enabled = COALESCE($8, low_stock_alert_enabled),
        variant_group = $9,
        variant_label = $10
      WHERE id = $11 AND company_id = $12 RETURNING *
    `, [name, barcode || null, stock, category || null, price || null, vatRate,
        lowStockThreshold || null, lowStockAlertEnabled, variantGroup || null, variantLabel || null,
        req.params.id, req.companyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ ok: true, product: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu barkod başka bir üründe kullanılıyor' });
    console.error(err);
    res.status(500).json({ error: 'Ürün güncellenemedi' });
  }
});

app.delete('/api/products/:id', authMiddleware, requireRole('yonetici'), async (req, res) => {
  try {
    const { rows } = await query(
      `DELETE FROM products WHERE id=$1 AND company_id=$2 RETURNING id`, [req.params.id, req.companyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Bu ürün geçmiş siparişlerde kullanıldığı için silinemiyor' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ürün silinemedi' });
  }
});

// Basit CSV içe aktarma: sku,name,barcode,stock,category,price,vatRate başlıklı satırlar bekler.
// Var olan SKU güncellenir, yoksa yeni oluşturulur.
app.post('/api/products/import-csv', authMiddleware, requireRole('yonetici'), async (req, res) => {
  const { csv } = req.body;
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv metni zorunlu' });

  const lines = csv.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV boş görünüyor (başlık + en az 1 satır gerekli)' });

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const skuIdx = idx('sku'), nameIdx = idx('name'), barcodeIdx = idx('barcode'), stockIdx = idx('stock'),
        catIdx = idx('category'), priceIdx = idx('price'), vatIdx = idx('vatrate');

  if (skuIdx === -1 || nameIdx === -1) {
    return res.status(400).json({ error: 'CSV başlığında en az "sku" ve "name" kolonları olmalı' });
  }

  let created = 0, updated = 0, errors = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const sku = cols[skuIdx];
    const name = cols[nameIdx];
    if (!sku || !name) { errors++; continue; }
    const barcode = barcodeIdx >= 0 ? (cols[barcodeIdx] || null) : null;
    const stock = stockIdx >= 0 ? (parseInt(cols[stockIdx], 10) || 0) : 0;
    const category = catIdx >= 0 ? (cols[catIdx] || null) : null;
    const price = priceIdx >= 0 ? (parseFloat(cols[priceIdx]) || null) : null;
    const vatRate = vatIdx >= 0 ? (parseFloat(cols[vatIdx]) || 20) : 20;

    try {
      const { rows: existing } = await query(
        `SELECT id FROM products WHERE company_id=$1 AND sku=$2`, [req.companyId, sku]
      );
      if (existing[0]) {
        await query(`
          UPDATE products SET name=$1, barcode=COALESCE($2,barcode), stock=$3, category=$4, price=$5, vat_rate=$6
          WHERE id=$7
        `, [name, barcode, stock, category, price, vatRate, existing[0].id]);
        updated++;
      } else {
        await query(`
          INSERT INTO products (company_id, sku, name, barcode, stock, category, price, vat_rate)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [req.companyId, sku, name, barcode, stock, category, price, vatRate]);
        created++;
      }
    } catch (err) {
      errors++;
    }
  }
  res.json({ ok: true, created, updated, errors, total: lines.length - 1 });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- Bildirimler: yeni gelen (henüz görülmemiş) siparişler ----------

app.get('/api/notifications/unseen', authMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT id, marketplace, marketplace_order_no, customer_name, created_at
    FROM orders WHERE company_id=$1 AND notified=false AND status='yeni'
    ORDER BY created_at ASC LIMIT 20
  `, [req.companyId]);
  res.json(rows);
});

app.post('/api/notifications/mark-seen', authMiddleware, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.json({ ok: true, updated: 0 });
  const { rowCount } = await query(
    `UPDATE orders SET notified=true WHERE company_id=$1 AND id = ANY($2::int[])`,
    [req.companyId, ids]
  );
  res.json({ ok: true, updated: rowCount });
});

// ---------- Pazarlama sitesi: demo/talep formu (herkese açık) ----------

app.post('/api/leads', async (req, res) => {
  const { name, companyName, email, phone, message } = req.body;
  if (!name || (!email && !phone)) {
    return res.status(400).json({ error: 'İsim ve e-posta ya da telefondan en az biri gerekli' });
  }
  await query(
    `INSERT INTO leads (name, company_name, email, phone, message) VALUES ($1,$2,$3,$4,$5)`,
    [name, companyName || null, email || null, phone || null, message || null]
  );
  res.json({ ok: true });
});

// ---------- Süper Admin: firmalardan bağımsız, ayrı giriş sistemi ----------

app.post('/api/superadmin/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query(`SELECT * FROM super_admins WHERE email=$1`, [email]);
  const admin = rows[0];
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }
  const token = jwt.sign({ type: 'super_admin', superAdminId: admin.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, name: admin.name });
});

app.get('/api/superadmin/leads', superAdminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT * FROM leads ORDER BY created_at DESC`);
  res.json(rows);
});

app.patch('/api/superadmin/leads/:id', superAdminMiddleware, async (req, res) => {
  const { status } = req.body;
  const { rows } = await query(
    `UPDATE leads SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Talep bulunamadı' });
  res.json(rows[0]);
});

app.get('/api/superadmin/companies', superAdminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, c.name, c.plan_status, c.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
      (SELECT COUNT(*) FROM orders o WHERE o.company_id = c.id) AS order_count,
      (SELECT COALESCE(SUM(order_count),0) FROM billing_usage b WHERE b.company_id = c.id) AS total_billed_orders
    FROM companies c ORDER BY c.created_at DESC
  `);
  res.json(rows);
});

// Yeni firma + ilk yönetici kullanıcısını tek seferde oluşturur.
app.post('/api/superadmin/companies', superAdminMiddleware, async (req, res) => {
  const { companyName, adminName, adminEmail, adminPassword } = req.body;
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'companyName, adminName, adminEmail, adminPassword zorunlu' });
  }
  const { rows: existing } = await query(`SELECT id FROM users WHERE email=$1`, [adminEmail]);
  if (existing[0]) return res.status(409).json({ error: 'Bu e-posta zaten kullanılıyor' });

  const { rows: [company] } = await query(
    `INSERT INTO companies (name, plan_status) VALUES ($1,'deneme') RETURNING id, name, plan_status, created_at`,
    [companyName]
  );
  await query(
    `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'yonetici')`,
    [company.id, adminName, adminEmail, bcrypt.hashSync(adminPassword, 8)]
  );
  res.json({ ok: true, company });
});

app.patch('/api/superadmin/companies/:id/status', superAdminMiddleware, async (req, res) => {
  const { status } = req.body; // 'deneme' | 'aktif' | 'dondurulmus'
  if (!['deneme', 'aktif', 'dondurulmus'].includes(status)) {
    return res.status(400).json({ error: 'Geçersiz durum' });
  }
  const { rows } = await query(
    `UPDATE companies SET plan_status=$1 WHERE id=$2 RETURNING id, name, plan_status`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Firma bulunamadı' });
  res.json(rows[0]);
});

// Bir firmanın yöneticisi kendi şifresini unutup kilitlenirse (çalışanını sıfırlayacak
// kimse kalmadıysa), süper admin e-posta ile bularak şifresini sıfırlayabilir.
app.patch('/api/superadmin/users/reset-password', superAdminMiddleware, async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'email ve en az 6 karakterli newPassword zorunlu' });
  }
  const { rows } = await query(
    `UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id, name, email, company_id`,
    [bcrypt.hashSync(newPassword, 8), email]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Bu e-postayla kullanıcı bulunamadı' });
  res.json({ ok: true, user: rows[0] });
});

// Vercel bu dosyayı bir sunucusuz fonksiyon olarak çalıştırır (app bir request handler'dır).
module.exports = app;

// Yerelde `node api/index.js` ile de doğrudan çalıştırılabilir (npm start bunu kullanır).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Backend http://localhost:${PORT} üzerinde çalışıyor`));
}
