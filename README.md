# Kargo Tarama Sistemi — v0.2 (Bulut/Vercel'e Hazır)

Bu sürüm artık **kimsenin bilgisayarında değil**, bulutta çalışacak şekilde kuruldu:

* Veritabanı: gerçek, kalıcı bir bulut Postgres (yerelde SQLite değil)
* Backend: Vercel'in sunucusuz (serverless) fonksiyon yapısına uygun
* Frontend (PWA): statik dosya olarak Vercel'den servis ediliyor

Mantık aynı: pazaryeri API'leri hâlâ **mock (sahte)** — gerçek anahtarların gelince
`api/index.js` içindeki `pushStockToMarketplaces` fonksiyonu gerçek isteklere dönüşecek.

## İki Ayrı Site, İki Ayrı Vercel Projesi

Pazarlama sitesi artık bu projede DEĞİL — ayrı bir "Sevkio Pazarlama Sitesi" paketinde
(`sevkio-marketing-site.zip`), tamamen ayrı bir Vercel projesi olarak deploy ediliyor.

* **Bu proje** (`sevkio` reposu) → `app.html`, `panel.html`, `superadmin.html`, tüm API
→ hedef alan adı: `sevkio.online` (satın alınca bağlanacak, şimdilik `sevkio.vercel.app`)
* **Ayrı proje** (`sevkio-marketing` reposu, ayrı zip'te) → sadece tanıtım sayfası
→ hedef alan adı: `sevkio.com` (satın alınca bağlanacak)

Bu projede kök adrese (`/`) gelen istek otomatik olarak `/app.html`'e yönlendirilir — çünkü
pazarlama sitesi artık burada değil, kök adresin bir işi kalmadı.

Pazarlama sitesini deploy etme adımları, indirdiğin `sevkio-marketing-site.zip` içindeki
kendi README'sinde var.

## Sistemin 4 Katmanı

Artık sistem 4 ayrı alandan oluşuyor, her biri farklı bir kişi için:

|Adres|Kim kullanır|Ne yapar|
|-|-|-|
|`/`|Herkes (halka açık)|Pazarlama sitesi — ürünü tanıtır, "Demo iste" formuyla talep toplar|
|`/superadmin.html`|Sadece sen (platform sahibi)|Yeni firma/müşteri ekler, firmaları dondurur/aktif eder, gelen talepleri görür|
|`/panel.html`|Firma yöneticisi (müşterin)|Pazaryeri bağlantıları + kendi çalışanlarını ekler/siler|
|`/app.html`|Depo çalışanı|Barkod okutur, kargoya verir (PWA, telefona eklenebilir)|

**Firma izolasyonu (çok önemli):** Her kullanıcının giriş yaptığında aldığı kimlik kartı (JWT token)
içine hangi firmaya ait olduğu damgalanır. Sunucudaki her sorgu bu damgayı kontrol eder — A
firmasının bir çalışanı, token'ını değiştirse bile B firmasının verisini asla göremez, çünkü
sorgu zaten "sadece benim firma numaramla eşleşenleri getir" diye çalışıyor. Bunu test ettim:
iki farklı firma oluşturup birbirlerinin ürün/sipariş verisine erişilemediğini doğruladım.

**Rol bazlı yetki:** `depo` rolündeki bir çalışan barkod okutup kargoya verebilir ama pazaryeri
bağlantılarını göremez/değiştiremez, yeni çalışan ekleyemez — bunlar sadece `yonetici` rolüne açık.

## Süper Admin hesabını ilk kez oluşturma

Vercel'de **Environment Variables** kısmına şunları ekle:

* `SUPERADMIN\_EMAIL` → kendi e-postan
* `SUPERADMIN\_PASSWORD` → güçlü bir şifre

Deploy ettiğinde (ya da yeniden deploy ettiğinde) sunucu ilk açılışında bu bilgilerle otomatik
bir süper admin hesabı oluşturur. Sonra `/superadmin.html` adresinden bu bilgilerle giriş yapıp
yeni müşteri firmalar ekleyebilirsin — her firma için bir isim + yönetici e-posta/şifre girip
"Firma Oluştur" diyorsun, o bilgileri müşteriye iletiyorsun, müşteri `/panel.html`'den giriş yapıp
kendi pazaryeri bağlantılarını ve çalışanlarını ekliyor.

## Vercel + GitHub + Supabase ile yükleme — adım adım

### 1\) Bu kodu GitHub'a koy

* github.com'da ücretsiz hesap aç (yoksa)
* Yeni bir repo oluştur (örnek: `kargo-sistemi`)
* Bu klasördeki dosyaları repoya yükle (GitHub web arayüzünde "Add file → Upload files" ile
sürükle-bırak yapabilirsin — `node\_modules` klasörünü YÜKLEME, zaten pakette yok)

### 2\) Supabase'de veritabanı oluştur

* supabase.com → "Start your project" → GitHub hesabınla giriş yap
* "New project" → bir isim ver (örnek: `kargo-sistemi`), bir veritabanı şifresi belirle (not al, lazım olacak), bölge olarak Avrupa'ya yakın bir tane seç (örnek: Frankfurt)
* Proje oluşunca sol menüden **Project Settings → Database** git
* "Connection string" bölümünde **"Connection pooling"** sekmesine geç (bu önemli — Vercel'in sunucusuz yapısı için normal bağlantı değil, pooler bağlantısı gerekiyor), **URI** formatını kopyala.
Şuna benzer bir şey olacak:
`postgresql://postgres.xxxxx:\[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
* `\[YOUR-PASSWORD]` yazan yere biraz önce belirlediğin şifreyi yaz

### 3\) Vercel'de projeyi bağla

* vercel.com → GitHub hesabınla giriş yap
* "Add New... → Project" → GitHub reposunu seç → "Import"
* Deploy etmeden önce "Environment Variables" kısmına şunları ekle:

  * `DATABASE\_URL` → 2. adımda kopyaladığın Supabase bağlantı adresi
  * `JWT\_SECRET` → uzun rastgele bir metin (örnek: `openssl rand -hex 32` çıktısı)
* "Deploy" de

### 4\) Demo veriyi Supabase'e yükle

Bilgisayarında (bir kere yapılacak):

```bash
cd kargo-sistemi
npm install
cp .env.example .env
# .env dosyasını aç, DATABASE\_URL satırını Supabase'den aldığın adresle değiştir, JWT\_SECRET'ı da gir
npm run seed
```

### 5\) Test et

Vercel sana verdiği `https://senin-proje-adin.vercel.app` adresini telefonundan aç.
Giriş: `depo@demo.com` / `123456`
Örnek barkodlar: `1288451236547`, `1288451236554`, `1288451236561`

Supabase panelinden ("Table Editor") verileri görsel olarak da görebilirsin — sipariş, ürün, stok her şey orada.

## Gerçek Trendyol hesabıyla test etme

Artık mock değil, **gerçek Trendyol Marketplace API'sine** bağlanan kod var. Arkadaşının
Trendyol Satıcı Paneli'nden ("Hesap Bilgilerim → Entegrasyon Bilgileri", partner.trendyol.com)
şu 3 bilgiyi alması gerekiyor: **Satıcı ID (sellerId)**, **API Key**, **API Secret**.

### 1\) Bağlantı bilgilerini sisteme kaydet

```bash
curl -X POST https://senin-proje-adin.vercel.app/api/marketplace-connections \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer BURAYA\_GIRIS\_TOKENIN" \\
  -d '{
    "marketplace": "trendyol",
    "sellerId": "ARKADAŞININ\_SATICI\_ID",
    "apiKey": "ARKADAŞININ\_API\_KEY",
    "apiSecret": "ARKADAŞININ\_API\_SECRET",
    "environment": "prod"
  }'
```

(Token'ı `/api/login` isteğinin cevabından alırsın — Postman kullanmak işini kolaylaştırır.)

### 2\) Gerçek siparişleri çek

```bash
curl -X POST https://senin-proje-adin.vercel.app/api/sync/trendyol \\
  -H "Authorization: Bearer BURAYA\_GIRIS\_TOKENIN"
```

Bu istek, son 14 gündeki gerçek Trendyol siparişlerini çekip veritabanına yazar. Sipariş
kalemlerindeki ürün barkodu sistemde kayıtlı değilse otomatik olarak (stok=0 ile) oluşturulur
— gerçek stok miktarını sonradan elle düzeltmen gerekir (henüz ürün yönetim paneli yok).

### 3\) Test et

PWA'dan (telefondan) gerçek bir Trendyol siparişinin kargo takip numarasını (barkod olarak
kargo etiketinde basılı olan numara) okut. Sipariş bilgisi gerçek Trendyol verisiyle gelecek.
"Kargoya Ver" dediğinde:

* Trendyol'daki paket **"Picking" (hazırlanıyor)** statüsüne geçer (gerçek API çağrısı)
* Stok gerçek `updatePriceAndInventory` servisiyle Trendyol'a bildirilir

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

Veritabanı tasarımı çoklu firma (multi-tenant) — her satırda `company\_id` var,
yani birden fazla müşteri firma aynı sistemi kullanabilir, verileri hiç karışmaz.

## Otomatik Sipariş Çekme (Vercel Cron)

Artık "Siparişleri Çek" butonuna basmak zorunda değilsin — sistem 6 saatte bir otomatik
kontrol ediyor. Bunun çalışması için Vercel'de bir ortam değişkeni daha eklemen gerekiyor:

* `CRON\_SECRET` → rastgele, uzun bir metin (örnek: `openssl rand -hex 32` çıktısı)

Bunu eklemezsen cron endpoint'i çalışmaz (güvenlik için kasıtlı olarak reddeder).
Vercel, bu değişkeni otomatik olarak cron isteklerine ekliyor, sen sadece değeri girmen yeterli.

**Not:** Vercel'in ücretsiz (Hobby) planında cron sıklığı konusunda kısıtlamalar olabilir
(plan detayları değişebiliyor) — eğer 6 saatte bir çalışmıyorsa Vercel hesabındaki
"Cron Jobs" sekmesinden veya güncel fiyatlandırma sayfasından kontrol et.

## Şifremi Unuttum

Henüz e-posta gönderme altyapısı olmadığı için "şifremi unuttum, linke tıkla" akışı yok.
Onun yerine:

* Bir çalışan şifresini unutursa → firma yöneticisi `/panel.html` → Çalışanlar → "Şifre Sıfırla"
* Firma yöneticisi şifresini unutursa (ve sıfırlayacak başka yönetici yoksa) → sen (süper admin)
`/superadmin.html` → "Kullanıcı Şifresi Sıfırla" bölümünden e-postasını girip sıfırlarsın

## Yönetici Paneli

`https://senin-proje-adin.vercel.app/admin.html` adresinden pazaryeri bağlantılarını
görsel arayüzden yönetebilirsin:

* Her pazaryeri için Satıcı ID / API Key / API Secret gir, "Kaydet"
* Aktif/Pasif anahtarıyla bir pazaryerini geçici olarak devre dışı bırak (kapattığında
o pazaryerine stok gönderilmez, sipariş çekilmez)
* "Siparişleri Çek" butonuyla o pazaryerinden manuel senkronizasyon tetikle
* Hepsiburada, ÇiçekSepeti, Amazon şu an "yakında" olarak görünüyor — henüz gerçek API'leri bağlı değil

Aynı giriş bilgilerini kullanır (depo@demo.com / 123456 demo için).

## Gerçek pazaryeri hesaplarıyla test etme

Artık **Trendyol ve N11** gerçek API'lerine bağlanıyor. Her ikisi de aynı mantıkla çalışır:

1. Yönetici panelinden (`/admin.html`) ilgili pazaryerine API bilgilerini gir ve kaydet
2. "Siparişleri Çek" butonuna bas (ya da `POST /api/sync/trendyol` / `POST /api/sync/n11`)
3. Gerçek siparişler veritabanına yazılır — kargo barkodunu PWA'dan okutup test edebilirsin
4. "Kargoya Ver" dediğinde:

   * **Trendyol**: paket gerçekten "Picking" statüsüne geçer, stok `updatePriceAndInventory` ile gönderilir
   * **N11**: sipariş satırları gerçekten "Picking" (onaylandı) statüsüne geçer, stok `price-stock-update` ile gönderilir (N11 barkod değil **stockCode/SKU** ile eşleştirir — ürünlerinin SKU'sunun N11'deki stok koduyla aynı olması gerekiyor)

**API bilgilerini nereden alırsın:**

* Trendyol: partner.trendyol.com → Hesabım → Entegrasyon Bilgileri
* N11: so.n11.com → Hesabım → API Hesapları

## Henüz mock (sahte) olan / sıradaki adımlar

* ~~Trendyol gerçek entegrasyonu~~ ✅
* ~~N11 gerçek entegrasyonu~~ ✅
* ~~Yönetici paneli (bağlantı ekleme/kapatma)~~ ✅
* **Hepsiburada** — API'si belirgin şekilde daha karmaşık (ayrı paketleme adımları, kendi kargo
sistemi "HepsiJet", fiyat kilitleme mekanizmaları). Ayrı bir tur gerektiriyor.
* **ÇiçekSepeti** — henüz araştırılmadı/entegre edilmedi
* **Amazon** — kapsam dışı bırakıldı (SP-API çok daha karmaşık, OAuth + onay süreci gerekiyor)
* Kargo firması barkod/etiket API'si
* Ürün ekleme/fiyat güncelleme ekranı (şu an sadece pazaryerinden otomatik senkronla geliyor)
* Ödeme/abonelik akışı (iyzico/Stripe)
* KVKK / kullanım şartları / gizlilik politikası metinleri..

