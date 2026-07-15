# Kargo Tarama Sistemi — v0.2 (Bulut/Vercel'e Hazır)

Bu sürüm artık **kimsenin bilgisayarında değil**, bulutta çalışacak şekilde kuruldu:
- Veritabanı: gerçek, kalıcı bir bulut Postgres (yerelde SQLite değil)
- Backend: Vercel'in sunucusuz (serverless) fonksiyon yapısına uygun
- Frontend (PWA): statik dosya olarak Vercel'den servis ediliyor

Mantık aynı: pazaryeri API'leri hâlâ **mock (sahte)** — gerçek anahtarların gelince
`api/index.js` içindeki `pushStockToMarketplaces` fonksiyonu gerçek isteklere dönüşecek.

## Vercel + GitHub + Supabase ile yükleme — adım adım

### 1) Bu kodu GitHub'a koy
- github.com'da ücretsiz hesap aç (yoksa)
- Yeni bir repo oluştur (örnek: `kargo-sistemi`)
- Bu klasördeki dosyaları repoya yükle (GitHub web arayüzünde "Add file → Upload files" ile
  sürükle-bırak yapabilirsin — `node_modules` klasörünü YÜKLEME, zaten pakette yok)

### 2) Supabase'de veritabanı oluştur
- supabase.com → "Start your project" → GitHub hesabınla giriş yap
- "New project" → bir isim ver (örnek: `kargo-sistemi`), bir veritabanı şifresi belirle (not al, lazım olacak), bölge olarak Avrupa'ya yakın bir tane seç (örnek: Frankfurt)
- Proje oluşunca sol menüden **Project Settings → Database** git
- "Connection string" bölümünde **"Connection pooling"** sekmesine geç (bu önemli — Vercel'in sunucusuz yapısı için normal bağlantı değil, pooler bağlantısı gerekiyor), **URI** formatını kopyala.
  Şuna benzer bir şey olacak:
  `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
- `[YOUR-PASSWORD]` yazan yere biraz önce belirlediğin şifreyi yaz

### 3) Vercel'de projeyi bağla
- vercel.com → GitHub hesabınla giriş yap
- "Add New... → Project" → GitHub reposunu seç → "Import"
- Deploy etmeden önce "Environment Variables" kısmına şunları ekle:
  - `DATABASE_URL` → 2. adımda kopyaladığın Supabase bağlantı adresi
  - `JWT_SECRET` → uzun rastgele bir metin (örnek: `openssl rand -hex 32` çıktısı)
- "Deploy" de

### 4) Demo veriyi Supabase'e yükle
Bilgisayarında (bir kere yapılacak):
```bash
cd kargo-sistemi
npm install
cp .env.example .env
# .env dosyasını aç, DATABASE_URL satırını Supabase'den aldığın adresle değiştir, JWT_SECRET'ı da gir
npm run seed
```

### 5) Test et
Vercel sana verdiği `https://senin-proje-adin.vercel.app` adresini telefonundan aç.
Giriş: `depo@demo.com` / `123456`
Örnek barkodlar: `1288451236547`, `1288451236554`, `1288451236561`

Supabase panelinden ("Table Editor") verileri görsel olarak da görebilirsin — sipariş, ürün, stok her şey orada.

## Gerçek Trendyol hesabıyla test etme

Artık mock değil, **gerçek Trendyol Marketplace API'sine** bağlanan kod var. Arkadaşının
Trendyol Satıcı Paneli'nden ("Hesap Bilgilerim → Entegrasyon Bilgileri", partner.trendyol.com)
şu 3 bilgiyi alması gerekiyor: **Satıcı ID (sellerId)**, **API Key**, **API Secret**.

### 1) Bağlantı bilgilerini sisteme kaydet
```bash
curl -X POST https://senin-proje-adin.vercel.app/api/marketplace-connections \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer BURAYA_GIRIS_TOKENIN" \
  -d '{
    "marketplace": "trendyol",
    "sellerId": "ARKADAŞININ_SATICI_ID",
    "apiKey": "ARKADAŞININ_API_KEY",
    "apiSecret": "ARKADAŞININ_API_SECRET",
    "environment": "prod"
  }'
```
(Token'ı `/api/login` isteğinin cevabından alırsın — Postman kullanmak işini kolaylaştırır.)

### 2) Gerçek siparişleri çek
```bash
curl -X POST https://senin-proje-adin.vercel.app/api/sync/trendyol \
  -H "Authorization: Bearer BURAYA_GIRIS_TOKENIN"
```
Bu istek, son 14 gündeki gerçek Trendyol siparişlerini çekip veritabanına yazar. Sipariş
kalemlerindeki ürün barkodu sistemde kayıtlı değilse otomatik olarak (stok=0 ile) oluşturulur
— gerçek stok miktarını sonradan elle düzeltmen gerekir (henüz ürün yönetim paneli yok).

### 3) Test et
PWA'dan (telefondan) gerçek bir Trendyol siparişinin kargo takip numarasını (barkod olarak
kargo etiketinde basılı olan numara) okut. Sipariş bilgisi gerçek Trendyol verisiyle gelecek.
"Kargoya Ver" dediğinde:
- Trendyol'daki paket **"Picking" (hazırlanıyor)** statüsüne geçer (gerçek API çağrısı)
- Stok gerçek `updatePriceAndInventory` servisiyle Trendyol'a bildirilir

**Not:** "Invoiced" (faturalandı) statüsüne geçiş için fatura numarası gerekiyor — bu henüz
sisteme bağlı değil, sıradaki adımlardan biri.


```bash
npm install
cp .env.example .env   # kendi yerel Postgres bilgini gir
npm run seed
npm start               # http://localhost:3000
```

## Mimari
```
api/index.js   -> tüm backend (Vercel sunucusuz fonksiyonu olarak çalışır)
lib/db.js      -> Postgres bağlantısı + tablo şeması
scripts/seed.js -> demo veri yükleme
public/        -> PWA (barkod okuma ekranı), statik olarak servis edilir
vercel.json    -> Vercel yönlendirme ayarı
```

Veritabanı tasarımı çoklu firma (multi-tenant) — her satırda `company_id` var,
yani birden fazla müşteri firma aynı sistemi kullanabilir, verileri hiç karışmaz.

## Yönetici Paneli

`https://senin-proje-adin.vercel.app/admin.html` adresinden pazaryeri bağlantılarını
görsel arayüzden yönetebilirsin:
- Her pazaryeri için Satıcı ID / API Key / API Secret gir, "Kaydet"
- Aktif/Pasif anahtarıyla bir pazaryerini geçici olarak devre dışı bırak (kapattığında
  o pazaryerine stok gönderilmez, sipariş çekilmez)
- "Siparişleri Çek" butonuyla o pazaryerinden manuel senkronizasyon tetikle
- Hepsiburada, ÇiçekSepeti, Amazon şu an "yakında" olarak görünüyor — henüz gerçek API'leri bağlı değil

Aynı giriş bilgilerini kullanır (depo@demo.com / 123456 demo için).

## Gerçek pazaryeri hesaplarıyla test etme

Artık **Trendyol ve N11** gerçek API'lerine bağlanıyor. Her ikisi de aynı mantıkla çalışır:

1. Yönetici panelinden (`/admin.html`) ilgili pazaryerine API bilgilerini gir ve kaydet
2. "Siparişleri Çek" butonuna bas (ya da `POST /api/sync/trendyol` / `POST /api/sync/n11`)
3. Gerçek siparişler veritabanına yazılır — kargo barkodunu PWA'dan okutup test edebilirsin
4. "Kargoya Ver" dediğinde:
   - **Trendyol**: paket gerçekten "Picking" statüsüne geçer, stok `updatePriceAndInventory` ile gönderilir
   - **N11**: sipariş satırları gerçekten "Picking" (onaylandı) statüsüne geçer, stok `price-stock-update` ile gönderilir (N11 barkod değil **stockCode/SKU** ile eşleştirir — ürünlerinin SKU'sunun N11'deki stok koduyla aynı olması gerekiyor)

**API bilgilerini nereden alırsın:**
- Trendyol: partner.trendyol.com → Hesabım → Entegrasyon Bilgileri
- N11: so.n11.com → Hesabım → API Hesapları

## Henüz mock (sahte) olan / sıradaki adımlar
- ~~Trendyol gerçek entegrasyonu~~ ✅
- ~~N11 gerçek entegrasyonu~~ ✅
- ~~Yönetici paneli (bağlantı ekleme/kapatma)~~ ✅
- **Hepsiburada** — API'si belirgin şekilde daha karmaşık (ayrı paketleme adımları, kendi kargo
  sistemi "HepsiJet", fiyat kilitleme mekanizmaları). Ayrı bir tur gerektiriyor.
- **ÇiçekSepeti** — henüz araştırılmadı/entegre edilmedi
- **Amazon** — kapsam dışı bırakıldı (SP-API çok daha karmaşık, OAuth + onay süreci gerekiyor)
- Kargo firması barkod/etiket API'si
- Ürün ekleme/fiyat güncelleme ekranı (şu an sadece pazaryerinden otomatik senkronla geliyor)
- Ödeme/abonelik akışı (iyzico/Stripe)
- KVKK / kullanım şartları / gizlilik politikası metinleri
