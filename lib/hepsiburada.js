// Hepsiburada Marketplace API istemcisi
// Kaynak: https://developers.hepsiburada.com (Basic Auth ile korunan servisler)
//
// ÖNEMLİ NOT: Hepsiburada'nın API'si Trendyol/N11'e göre belirgin daha karmaşık —
// katalog ve listeleme diye iki ayrı ürün modeli var, kendi kargo sistemi "HepsiJet"
// tamamen ayrı bir API ve kimlik doğrulama (token bazlı) kullanıyor. Bu dosya sadece
// TEMEL akışı (sipariş çekme, stok güncelleme, kargoya verildi bildirimi) kapsar.
// HepsiJet'in kendi lojistik/gönderi API'si bu kapsamda DEĞİLDİR — ayrı bir iş.
//
// Üç ayrı alt servisin üç ayrı temel adresi var (satıcı hesabı açılınca Hepsiburada
// Satıcı Paneli → Entegrasyonlar'dan alınan bilgiler bunlar):
//   - Sipariş/paket servisleri : oms-external(-sit).hepsiburada.com
//   - Stok/fiyat (listing) servisleri : listing-external(-sit).hepsiburada.com
//   - Katalog (ürün) servisleri : mpop(-sit).hepsiburada.com
// "-sit" eki test ortamı, prod'da bu ek kaldırılır.

const BASE_URLS = {
  prod: { oms: 'https://oms-external.hepsiburada.com', listing: 'https://listing-external.hepsiburada.com' },
  stage: { oms: 'https://oms-external-sit.hepsiburada.com', listing: 'https://listing-external-sit.hepsiburada.com' },
};

function authHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

// Hepsiburada'da conn.api_key = kullanıcı adı, conn.api_secret = şifre, conn.seller_id = merchantId
async function hbRequest(conn, base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Authorization': authHeader(conn.api_key, conn.api_secret),
      'User-Agent': `${conn.seller_id} - SelfIntegration`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const err = new Error(`Hepsiburada API hatası (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Sipariş paketlerini çeker.
async function getOrders(conn, { startDate, endDate, limit = 50, offset = 0 } = {}) {
  const urls = BASE_URLS[conn.environment] || BASE_URLS.prod;
  const params = new URLSearchParams();
  if (startDate) params.set('begindate', new Date(startDate).toISOString());
  if (endDate) params.set('enddate', new Date(endDate).toISOString());
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return hbRequest(conn, urls.oms, 'GET', `/packages/merchantid/${conn.seller_id}?${params}`);
}

// Stok günceller. items: [{ merchantSku, quantity }]
async function updateStock(conn, items) {
  const urls = BASE_URLS[conn.environment] || BASE_URLS.prod;
  const payload = items.map(i => ({ merchantSku: i.merchantSku, availableStock: i.quantity }));
  return hbRequest(conn, urls.listing, 'POST', `/listings/merchantid/${conn.seller_id}/inventory-uploads`, payload);
}

// Paketi "kargoda" (intransit) statüsüne çeker.
async function markInTransit(conn, packageNumber) {
  const urls = BASE_URLS[conn.environment] || BASE_URLS.prod;
  return hbRequest(conn, urls.oms, 'POST', `/packages/merchantid/${conn.seller_id}/packagenumber/${packageNumber}/intransit`, {});
}

module.exports = { getOrders, updateStock, markInTransit };
