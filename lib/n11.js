// N11 Marketplace API istemcisi
// Kaynak: https://magazadestek.n11.com (RestAPI Sipariş Listeleme, Fiyat-Stok Güncelleme,
// Sipariş Kalemlerini Güncelleme servisleri). N11'de appkey/appsecret custom header olarak
// gönderilir (Basic Auth değil, Trendyol'dan farklı).

const BASE_URL = 'https://api.n11.com';

function headers(conn) {
  return {
    'appkey': conn.api_key,
    'appsecret': conn.api_secret,
    'Content-Type': 'application/json',
  };
}

async function n11Request(conn, method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: headers(conn),
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const err = new Error(`N11 API hatası (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Sipariş paketlerini çeker (GetShipmentPackages)
async function getOrders(conn, { startDate, endDate, page = 0, size = 100, status } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', String(startDate));
  if (endDate) params.set('endDate', String(endDate));
  params.set('page', String(page));
  params.set('size', String(size));
  if (status) params.set('status', status);
  return n11Request(conn, 'GET', `/rest/delivery/v1/shipmentPackages?${params}`);
}

// Stok/fiyat günceller. N11 ürünleri barkod değil STOKCODE (bizim sku alanımız) ile eşleştiriyor.
// items: [{ stockCode, quantity }]
async function updateStock(conn, items) {
  return n11Request(conn, 'POST', '/ms/product/tasks/price-stock-update', {
    payload: {
      integrator: 'KargoTaraSistemi',
      skus: items.map(i => ({ stockCode: i.stockCode, quantity: i.quantity })),
    },
  });
}

// Siparişi "Picking" (onaylandı/hazırlanıyor) statüsüne çeker.
// lineIds: N11'in orderLineId değerleri (order satırı bazında)
async function markPicking(conn, lineIds) {
  return n11Request(conn, 'PUT', '/rest/order/v1/update', {
    lines: lineIds.map(id => ({ lineId: id })),
    status: 'Picking',
  });
}

module.exports = { getOrders, updateStock, markPicking };
