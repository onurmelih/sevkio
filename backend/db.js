const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'kargo.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
-- Sistemi satın alan her firma (müşterimiz) bir "company" satırı.
-- Bütün diğer tablolar company_id ile buna bağlı -> veriler firmalar arasında asla karışmaz.
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'deneme',   -- deneme | aktif | dondurulmus
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Firma çalışanları (depo personeli, yönetici vs.)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'depo',   -- depo | yonetici
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Her firmanın kendi pazaryeri API bağlantı bilgileri (şimdilik boş/mock, ileride gerçek key'ler)
CREATE TABLE IF NOT EXISTS marketplace_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  marketplace TEXT NOT NULL,     -- trendyol | n11 | hepsiburada | amazon | ciceksepeti
  api_key TEXT,
  api_secret TEXT,
  seller_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, marketplace)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, sku),
  UNIQUE(company_id, barcode)
);

CREATE TABLE IF NOT EXISTS marketplace_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  marketplace TEXT NOT NULL,
  marketplace_product_id TEXT NOT NULL,
  UNIQUE(company_id, product_id, marketplace)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  marketplace TEXT NOT NULL,
  marketplace_order_no TEXT NOT NULL,
  cargo_barcode TEXT NOT NULL,        -- kargo firmasının verdiği barkod (etikette SADECE bu var)
  customer_name TEXT,
  customer_address TEXT,
  status TEXT NOT NULL DEFAULT 'yeni', -- yeni | hazirlaniyor | kargoda | teslim | iptal
  billed INTEGER NOT NULL DEFAULT 0,   -- bu sipariş faturalandı mı (sipariş bazlı ücretlendirme için)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, cargo_barcode)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  product_id INTEGER NOT NULL,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,          -- siparis | manuel_duzeltme | iade
  order_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sipariş bazlı faturalama: her ay her firma için kaç sipariş işlendi
CREATE TABLE IF NOT EXISTS billing_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  period TEXT NOT NULL,          -- '2026-07' gibi yıl-ay
  order_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, period)
);
`);

module.exports = db;
