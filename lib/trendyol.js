// Trendyol Marketplace API istemcisi
// Kaynak: https://developers.trendyol.com (Authorization, getShipmentPackages,
// updatePriceAndInventory, updatePackageStatus servisleri)

const BASE_URL = {
  prod: 'https://apigw.trendyol.com/integration',
  stage: 'https://stageapigw.trendyol.com/integration',
};

function authHeader(apiKey, apiSecret) {
  const token = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

async function trendyolRequest(conn, method, path, body) {
  const base = BASE_URL[conn.environment] || BASE_URL.prod;
  const res = await fetch(base + path, {
    method,
    headers: {
      'Authorization': authHeader(conn.api_key, conn.api_secret),
      // Trendyol, User-Agent olmayan istekleri 403 ile reddediyor.
      'User-Agent': `${conn.seller_id} - SelfIntegration`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!res.ok) {
    const err = new Error(`Trendyol API hatası (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Sipariş paketlerini çeker. Trendyol varsayılan olarak son 2 haftayı sınırlıyor
// olabilir; ilk senkronda geniş bir tarih aralığı veriyoruz.
async function getOrders(conn, { startDate, endDate, page = 0, size = 50, status } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', String(startDate));
  if (endDate) params.set('endDate', String(endDate));
  params.set('page', String(page));
  params.set('size', String(size));
  if (status) params.set('status', status);
  return trendyolRequest(conn, 'GET', `/order/sellers/${conn.seller_id}/orders?${params}`);
}

// Stok günceller. items: [{ barcode, quantity }]
async function updateStock(conn, items) {
  return trendyolRequest(
    conn, 'POST',
    `/inventory/sellers/${conn.seller_id}/products/price-and-inventory`,
    { items }
  );
}

// Paketi "Picking" (hazırlanıyor) statüsüne çeker — depo çalışanının "kargoya ver"
// demesi karşılığında Trendyol tarafında atılması gereken ilk gerçek adım budur.
// "Invoiced" statüsü fatura numarası gerektirdiği için ayrı bir adımda ele alınacak.
async function markPicking(conn, packageId) {
  return trendyolRequest(
    conn, 'PUT',
    `/order/sellers/${conn.seller_id}/shipment-packages/${packageId}`,
    { status: 'Picking' }
  );
}

module.exports = { getOrders, updateStock, markPicking };
