require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, ensureSchema, pool } = require('../lib/db');

async function main() {
  await ensureSchema();

  const { rows: [company] } = await query(
    `INSERT INTO companies (name, plan_status) VALUES ($1, 'deneme') RETURNING id`,
    ['Demo Firma A.Ş.']
  );
  const companyId = company.id;

  await query(
    `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
    [companyId, 'Demo Yönetici', 'depo@demo.com', bcrypt.hashSync('123456', 8), 'yonetici']
  );

  const products = [
    { sku: 'TS-001', name: 'Erkek Pamuklu T-Shirt - Siyah - L', barcode: '8690001000019', stock: 42 },
    { sku: 'CN-014', name: 'Kadın Slim Fit Kot Pantolon - 38 Beden', barcode: '8690001000026', stock: 17 },
    { sku: 'AY-007', name: 'Unisex Spor Ayakkabı - 42 Numara', barcode: '8690001000033', stock: 5 },
  ];

  const marketplaces = ['trendyol', 'n11', 'hepsiburada', 'amazon', 'ciceksepeti'];
  const productIds = {};

  for (const p of products) {
    const { rows: [row] } = await query(
      `INSERT INTO products (company_id, sku, name, barcode, stock) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, p.sku, p.name, p.barcode, p.stock]
    );
    productIds[p.sku] = row.id;
    let i = 0;
    for (const mp of marketplaces) {
      await query(
        `INSERT INTO marketplace_mappings (company_id, product_id, marketplace, marketplace_product_id) VALUES ($1,$2,$3,$4)`,
        [companyId, row.id, mp, `${mp.toUpperCase()}-${p.sku}-${i}`]
      );
      i++;
    }
  }

  const demoOrders = [
    { mp: 'trendyol', orderNo: 'TY-88213', barcode: '1288451236547', customer: 'Ahmet Yılmaz', addr: 'Kadıköy / İstanbul', items: [{ sku: 'TS-001', qty: 1 }] },
    { mp: 'hepsiburada', orderNo: 'HB-44921', barcode: '1288451236554', customer: 'Elif Demir', addr: 'Çankaya / Ankara', items: [{ sku: 'CN-014', qty: 1 }, { sku: 'TS-001', qty: 2 }] },
    { mp: 'amazon', orderNo: 'AMZ-70012', barcode: '1288451236561', customer: 'Mert Kaya', addr: 'Bornova / İzmir', items: [{ sku: 'AY-007', qty: 1 }] },
  ];

  for (const o of demoOrders) {
    const { rows: [orderRow] } = await query(
      `INSERT INTO orders (company_id, marketplace, marketplace_order_no, cargo_barcode, customer_name, customer_address, status)
       VALUES ($1,$2,$3,$4,$5,$6,'yeni') RETURNING id`,
      [companyId, o.mp, o.orderNo, o.barcode, o.customer, o.addr]
    );
    for (const it of o.items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1,$2,$3)`,
        [orderRow.id, productIds[it.sku], it.qty]
      );
    }
  }

  console.log('Seed tamam. company_id =', companyId);
  console.log('Giriş: depo@demo.com / 123456');
  console.log('Denemek için örnek barkodlar:', demoOrders.map(o => o.barcode).join(', '));
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
