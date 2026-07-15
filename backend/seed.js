const bcrypt = require('bcryptjs');
const db = require('./db');

const company = db.prepare(`INSERT INTO companies (name, plan_status) VALUES (?, 'deneme')`)
  .run('Demo Firma A.Ş.');
const companyId = company.lastInsertRowid;

db.prepare(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)`)
  .run(companyId, 'Depo Çalışanı', 'depo@demo.com', bcrypt.hashSync('123456', 8), 'depo');

const products = [
  { sku: 'TS-001', name: 'Erkek Pamuklu T-Shirt - Siyah - L', barcode: '8690001000019', stock: 42 },
  { sku: 'CN-014', name: 'Kadın Slim Fit Kot Pantolon - 38 Beden', barcode: '8690001000026', stock: 17 },
  { sku: 'AY-007', name: 'Unisex Spor Ayakkabı - 42 Numara', barcode: '8690001000033', stock: 5 },
];

const insertProduct = db.prepare(
  `INSERT INTO products (company_id, sku, name, barcode, stock) VALUES (?,?,?,?,?)`
);
const insertMapping = db.prepare(
  `INSERT INTO marketplace_mappings (company_id, product_id, marketplace, marketplace_product_id) VALUES (?,?,?,?)`
);

const marketplaces = ['trendyol', 'n11', 'hepsiburada', 'amazon', 'ciceksepeti'];

const productIds = {};
for (const p of products) {
  const res = insertProduct.run(companyId, p.sku, p.name, p.barcode, p.stock);
  productIds[p.sku] = res.lastInsertRowid;
  marketplaces.forEach((mp, i) => {
    insertMapping.run(companyId, res.lastInsertRowid, mp, `${mp.toUpperCase()}-${p.sku}-${i}`);
  });
}

const insertOrder = db.prepare(`
  INSERT INTO orders (company_id, marketplace, marketplace_order_no, cargo_barcode, customer_name, customer_address, status)
  VALUES (?,?,?,?,?,?,'yeni')
`);
const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)`);

const demoOrders = [
  { mp: 'trendyol', orderNo: 'TY-88213', barcode: '1288451236547', customer: 'Ahmet Yılmaz', addr: 'Kadıköy / İstanbul', items: [{ sku: 'TS-001', qty: 1 }] },
  { mp: 'hepsiburada', orderNo: 'HB-44921', barcode: '1288451236554', customer: 'Elif Demir', addr: 'Çankaya / Ankara', items: [{ sku: 'CN-014', qty: 1 }, { sku: 'TS-001', qty: 2 }] },
  { mp: 'amazon', orderNo: 'AMZ-70012', barcode: '1288451236561', customer: 'Mert Kaya', addr: 'Bornova / İzmir', items: [{ sku: 'AY-007', qty: 1 }] },
];

for (const o of demoOrders) {
  const res = insertOrder.run(companyId, o.mp, o.orderNo, o.barcode, o.customer, o.addr);
  for (const it of o.items) {
    insertItem.run(res.lastInsertRowid, productIds[it.sku], it.qty);
  }
}

console.log('Seed tamam. company_id =', companyId);
console.log('Giriş: depo@demo.com / 123456');
console.log('Denemek için örnek barkodlar:', demoOrders.map(o => o.barcode).join(', '));
