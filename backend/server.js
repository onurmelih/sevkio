const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = 'demo-gelistirme-anahtari-PRODUCTIONDA-DEGISTIR';
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ---------- Yardımcılar ----------

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

// Gerçek entegrasyon geldiğinde bu fonksiyon her pazaryerinin API'sine
// "stok güncelle" isteği atacak. Şimdilik mock: sadece log'a yazıyor.
async function pushStockToMarketplaces(companyId, productId, newStock) {
  const mappings = db.prepare(
    `SELECT marketplace, marketplace_product_id FROM marketplace_mappings WHERE company_id=? AND product_id=?`
  ).all(companyId, productId);

  for (const m of mappings) {
    // TODO: gerçek API çağrısı burada olacak (Trendyol/N11/Hepsiburada/Amazon/ÇiçekSepeti)
    console.log(`[MOCK] ${m.marketplace} -> ürün ${m.marketplace_product_id} stok = ${newStock}`);
  }
  return mappings.length;
}

// ---------- Auth ----------

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }
  const token = jwt.sign({ companyId: user.company_id, userId: user.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, name: user.name, role: user.role });
});

// ---------- Barkod okuma (PWA bunu çağırıyor) ----------

app.get('/api/scan/:barcode', authMiddleware, (req, res) => {
  const order = db.prepare(
    `SELECT * FROM orders WHERE company_id = ? AND cargo_barcode = ?`
  ).get(req.companyId, req.params.barcode);

  if (!order) return res.status(404).json({ error: 'Bu barkoda ait sipariş bulunamadı' });

  const items = db.prepare(`
    SELECT oi.quantity, p.name, p.sku, p.stock
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(order.id);

  res.json({ order, items });
});

// ---------- Siparişi kargoya ver -> otomatik stok düşür + tüm pazaryerlerine yay ----------

app.post('/api/orders/:id/ship', authMiddleware, async (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND company_id = ?`)
    .get(req.params.id, req.companyId);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  if (order.status !== 'yeni' && order.status !== 'hazirlaniyor') {
    return res.status(400).json({ error: `Bu sipariş zaten "${order.status}" durumunda` });
  }

  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(order.id);

  const tx = db.transaction(() => {
    for (const item of items) {
      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(item.product_id);
      const newStock = Math.max(0, product.stock - item.quantity);
      db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(newStock, product.id);
      db.prepare(`
        INSERT INTO stock_log (company_id, product_id, change, reason, order_id) VALUES (?,?,?,?,?)
      `).run(req.companyId, product.id, -item.quantity, 'siparis', order.id);
      item._newStock = newStock; // sonra pazaryerlerine göndermek için
    }
    db.prepare(`UPDATE orders SET status = 'kargoda', billed = 1 WHERE id = ?`).run(order.id);

    const period = new Date().toISOString().slice(0, 7);
    db.prepare(`
      INSERT INTO billing_usage (company_id, period, order_count) VALUES (?, ?, 1)
      ON CONFLICT(company_id, period) DO UPDATE SET order_count = order_count + 1
    `).run(req.companyId, period);
  });
  tx();

  let pushedTo = 0;
  for (const item of items) {
    pushedTo += await pushStockToMarketplaces(req.companyId, item.product_id, item._newStock);
  }

  res.json({ ok: true, status: 'kargoda', marketplacesUpdated: pushedTo });
});

// ---------- Ürün/stok listesi ----------

app.get('/api/products', authMiddleware, (req, res) => {
  const products = db.prepare(`SELECT * FROM products WHERE company_id = ? ORDER BY name`).all(req.companyId);
  res.json(products);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend http://localhost:${PORT} üzerinde çalışıyor`));
