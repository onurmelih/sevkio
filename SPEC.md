# Sevkio — Proje Spesifikasyonu (51 Soru Sonucu)

Bu doküman, 15 Temmuz 2026'da yapılan detaylı soru-cevap turunun sonucudur. Sıradaki
geliştirme çalışmaları bu kararlara göre yapılacak.

## 1. Ödeme / Abonelik
- Altyapı: iyzico (başkası adına) ya da Shopier — icra kaydı nedeniyle netleşecek
- Model: Taban ücret + sipariş başına ek (karışık)
- Ücretsiz deneme: 14 gün
- Fatura: e-Fatura/e-Arşiv kesilecek (muhasebeci gerekiyor)
- Ödeme alınamazsa: hesap dondurulur (giriş engellenir)
- Pazar: Sadece Türkiye (TL)
- Otomatik aylık çekim: Evet
- Firma kaydı: Ödeme onayı sonrası otomatik + süper admin de manuel ekleyebilir

## 2. Paketler
| Paket | Taban | Sipariş başına | Çalışan | Depo | Pazaryeri limiti |
|---|---|---|---|---|---|
| Start | 299₺/ay | 0,50₺ | 3 | 1 | Yok (hepsi açık) |
| Growth | 699₺/ay | 0,35₺ | 10 | 3 | Yok (hepsi açık) |
| Pro | 1.499₺/ay | 0,25₺ | Sınırsız | Sınırsız | Yok (hepsi açık) |

Paketler arası fark sadece çalışan/depo limiti — pazaryeri sayısı tüm paketlerde aynı.
Üst paket sipariş başına ücreti düşürerek yükseltmeyi teşvik eder.

## 3. Ürün Yönetimi Ekranı
- Ekleme yöntemleri: Elle form + Excel/CSV toplu + barkod ile ekleme (3'ü de)
- Fotoğraf: Yok (MVP'de gerek yok)
- Kategori/koleksiyon: Var
- Varyant desteği: Var (Beden, Renk vb.)
- Düşük stok uyarısı: Var, açılıp kapanabilir, eşik değeri müşteri belirler
- KDV oranı: Ürün bazında girilebilir

## 4. Çoklu Depo
- Bir firma birden fazla depo/şube yönetebilir
- Stoklar depo bazında ayrı tutulur
- Sipariş hangi depodan karşılanacağını sistem otomatik seçer

## 5. İade Yönetimi
- İade/geri gönderi takibi var
- Stok otomatik geri eklenmez — yönetici onayı gerekir

## 6. Bildirimler
- Yeni sipariş: Uygulama içi sesli + görsel bildirim
- Ses açılıp kapanabilir olmalı
- Destek talepleri: WhatsApp + e-posta + uygulama içi chat (hepsi)

## 7. Çalışan Performansı
- Kim hangi siparişi ne zaman kargoya verdi kaydı tutulur

## 8. Süper Admin
- Genel platform istatistiği görür (toplam sipariş, toplam ciro — tüm firmalar)
- Destek amaçlı bir firmanın verisini görüntüleyebilir
- Bunu yaptığında firma panelinde şeffaflık bildirimi gösterilir
  ("Süper admin bu firmaya destek amaçlı erişebilir")

## 9. Pazaryeri Entegrasyonları — Sıra
1. ~~Trendyol~~ ✅ tamamlandı
2. ~~N11~~ ✅ tamamlandı
3. Hepsiburada (+ kendi kargo sistemi HepsiJet entegrasyonu dahil)
4. ÇiçekSepeti (genel müşteri kitlesi için, sadece çiçek sektörüne özel değil)
5. Amazon — zamanlama henüz belirsiz, öncelik değil

## 10. Tasarım / Marka
- Marka adı: **Sevkio** (kesinleşti)
- Renk teması: Koyu yeşil + beyaz (kargo/lojistik hissi) — mevcut lacivert/amber temadan değişecek
- Marka tonu: Enerjik / genç
- Logo: Gerçek bir logo/ikon tasarlanmalı (ileride grafik tasarımcı ile)
- Alan adı: Şimdilik vercel.app ile devam, sonra karar verilecek
- Dil: Sadece Türkçe
- Platform: PWA yeterli, mağaza uygulamasına gerek yok

## 11. Genel / Lansman
- İlk müşteri kaynağı: Henüz karar verilmedi
- Lansman süresi: Acele yok, hazır olunca

## Geliştirme Sırası (kolaydan zora)
1. ~~Tasarım yenileme~~ ✅ tamamlandı (yeşil/beyaz tema, 4 arayüzde)
2. ~~Ürün yönetimi ekranı~~ ✅ tamamlandı (barkod/CSV/form ekleme, varyant, KDV, düşük stok uyarısı)
3. ~~Bildirim sistemi~~ ✅ tamamlandı (app içi sesli/görsel + aç-kapa, app.html + panel.html)
4. ~~İade yönetimi~~ ✅ tamamlandı (çalışan bildirir, yönetici onaylar, onaydan sonra stok+pazaryeri güncellenir)
5. Çoklu depo desteği
6. Çalışan performans takibi
7. Süper admin platform istatistikleri + şeffaflık bildirimi
8. Paket limitleri (çalışan/depo sayısı) + paket sayfası (Start/Growth/Pro)
9. Hepsiburada + HepsiJet entegrasyonu
10. ÇiçekSepeti entegrasyonu
11. Ödeme sistemi (iyzico/Shopier + otomatik kayıt + e-Fatura) — hesap kararına bağlı
12. KVKK metni + kullanım şartları (avukat/şablon ile)
13. Amazon — zamanı geldiğinde

## Bu Turda Eklenenler (dış hesap gerektirmeyenler)
- ~~Sipariş listesi ekranı~~ ✅ (panel.html "Siparişler" sekmesi, durum/pazaryeri filtreli, listeden direkt kargoya verme)
- ~~Şifre sıfırlama~~ ✅ (yönetici → kendi çalışanı, süper admin → herhangi bir kullanıcı e-postayla)
- ~~Otomatik sipariş çekme~~ ✅ (Vercel Cron, 6 saatte bir, `/api/cron/sync-all`, `CRON_SECRET` ile korunuyor)
- ~~Yazdırılabilir sevkiyat fişi~~ ✅ (resmi e-Fatura DEĞİL, sadece depo içi paketleme fişi)
- ~~SEO temelleri~~ ✅ (pazarlama sitesinde robots.txt + sitemap.xml)

## Dış Hesap Gerektiren (kod hazır değil, önce şu hesapları açman lazım)
- **Google Analytics**: Bir GA4 hesabı açıp "Measurement ID" alman lazım, sonra bana ver, siteye ekleyeyim
- **Canlı destek/chat**: Tawk.to (ücretsiz) ya da benzeri bir hesap aç, widget kodunu/ID'sini ver
- **Hata takibi**: Sentry.io hesabı aç, DSN anahtarını ver
- **E-posta gönderimi** (şifremi unuttum e-postası, sipariş bildirimi e-postası vs.): Resend.com ya da benzeri bir e-posta servisi hesabı + API key gerekiyor
- **Ödeme sistemi**: iyzico/Shopier hesap kararı netleşince
- **Gerçek e-Fatura**: Muhasebeci + bir e-Fatura entegratörü (Logo, Paraşüt, Uyumsoft vs.) hesabı
