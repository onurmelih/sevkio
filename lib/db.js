const { Pool } = require('pg');

// Vercel + Neon/Vercel Postgres entegrasyonu kurulduğunda bu ortam değişkenlerini
// otomatik sağlar (DATABASE_URL ya da POSTGRES_URL). Yerelde .env dosyasından okunur.
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL tanımlı değil. .env dosyasına ya da Vercel ortam değişkenlerine ekle.');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

// Tabloları oluşturur (yoksa). Uygulama her açılışta çağırır, IF NOT EXISTS olduğu için güvenli.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      plan_status TEXT NOT NULL DEFAULT 'deneme',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'depo',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS marketplace_connections (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      marketplace TEXT NOT NULL,
      api_key TEXT,
      api_secret TEXT,
      seller_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(company_id, marketplace)
    );
    ALTER TABLE marketplace_connections ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'prod';

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      UNIQUE(company_id, sku),
      UNIQUE(company_id, barcode)
    );

    CREATE TABLE IF NOT EXISTS marketplace_mappings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      marketplace TEXT NOT NULL,
      marketplace_product_id TEXT NOT NULL,
      UNIQUE(company_id, product_id, marketplace)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      marketplace TEXT NOT NULL,
      marketplace_order_no TEXT NOT NULL,
      cargo_barcode TEXT NOT NULL,
      customer_name TEXT,
      customer_address TEXT,
      status TEXT NOT NULL DEFAULT 'yeni',
      billed INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(company_id, cargo_barcode)
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketplace_package_id TEXT;

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL
    );
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS marketplace_line_id TEXT;

    CREATE TABLE IF NOT EXISTS stock_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      change INTEGER NOT NULL,
      reason TEXT NOT NULL,
      order_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS billing_usage (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      period TEXT NOT NULL,
      order_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(company_id, period)
    );
  `);
}

module.exports = { pool, query, ensureSchema };
