# 💧 Havza Bekçisi

**İstanbul'un içme suyu havzalarındaki kaçak hafriyat ve moloz dökümünü uydu görüntüleri ve yapay zekâ ile erken tespit eden bir prototip.**

🔗 **Canlı demo:** [buraya Netlify linki eklenecek]
🎥 **Tanıtım videosu:** [buraya video linki eklenecek]

UP School Climathon 2026 kapsamında geliştirildi.

---

## Problem

İstanbul'da her ay milyonlarca ton hafriyat çıkıyor, ancak resmi döküm sahalarının bir kısmı dolu ve yasal döküm ücretleri hızla artıyor. Bu nedenle hafriyatın bir kısmı orman, tarım arazisi ve **içme suyu havzalarına** kaçak olarak dökülüyor. Kaçak döküm genellikle plakasız kamyonlarla ve gece yapıldığı için mevcut GPS takip sistemlerinin dışında kalıyor.

**Kök neden:** Döküm, ancak biri fark edip ihbar ettiğinde, çoğu zaman haftalar sonra görünür hâle geliyor. Bu sırada barajlar zaten kritik seviyelerde.

## Çözüm

Havza Bekçisi, bir noktanın **eski** ve **güncel** uydu görüntüsünü karşılaştırır, değişimi **Google Gemini** ile sınıflandırır ve noktayı **suya yakınlığına göre önceliklendirir**. Böylece döküm, birinin ihbar etmesini beklemeden görünür olur.

Pilot alan: **Büyükçekmece Gölü havzası.**

### Nasıl çalışıyor?

1. **Bölge bul:** Kullanıcı mahalle arar ya da haberlerde geçen bölgelerin kısayollarını kullanır.
2. **Noktaya tıkla:** Şüpheli bir toprak veya moloz alanı seçilir.
3. **Görüntüler alınır:** Sunucu, Esri World Imagery Wayback arşivinden seçilen eski tarihin ve güncel görüntünün aynı karesini indirir.
4. **Yapay zekâ sınıflandırır:** Gemini iki görüntüyü karşılaştırır; sonucu *kaçak döküm şüphesi, yasal inşaat, tarım, yol/altyapı, değişim yok* veya *belirsiz* olarak, güven skoru ve Türkçe açıklamayla verir.
5. **Önceliklendirme:** Noktanın göle uzaklığı hesaplanır, İSKİ koruma bandı (yaklaşık) belirlenir ve öncelik puanı üretilir.
6. **İnsan doğrulaması:** Kullanıcı önce/sonra kaydırıcısıyla sonucu kendi gözüyle kontrol eder ve "doğru tespit" ya da "yanlış alarm" olarak işaretler. Doğruluk istatistikleri buradan hesaplanır.

### Yapay zekânın rolü

Gemini çözümün **çekirdeğinde** çalışır: iki uydu görüntüsü arasındaki değişimi **algılar ve sınıflandırır**. İnsanın tek tek inceleyemeyeceği genişlikteki havzayı taramayı mümkün kılar. **Yaptırım kararı her zaman insanda kalır**; sistem bir karar destek aracıdır.

Gemini'ye verilen talimat, mevsimsel yanlış alarmları önleyecek şekilde tasarlandı: kar, bitkilerin mevsimsel renk değişimi, göl seviyesindeki değişim, sazlıklar ve tarla sürme açıkça "döküm değildir" olarak tanımlandı.

## Test sonuçları (ön test)

Sonuçlar, sistemin kullandığı uydu görüntüleri üzerinde **görsel olarak doğrulanmıştır; saha doğrulaması yapılmamıştır.**

**Son durum (15 nokta):**

| Sonuç | Sayı |
| --- | --- |
| Doğru tespit (görünür hafriyat dökümü) | 1 |
| Yanlış alarm | 0 |
| Doğru "döküm yok" | 14 |
| Doğruluk | %100 |

- **Yanlış alarmların ayıklanması:** Büyükçekmece Gölü kıyısındaki ilk analizlerde, çoğu kış görüntüsüyle (Şubat 2014) yapılan karşılaştırmalarda **6 noktada** kaçak döküm alarmı çıktı. Bu alarmların kar, göl seviyesindeki düşüş, sazlıklar ve tarla değişimlerinden kaynaklandığı görüldü. Gemini talimatı bu durumları ayırt edecek şekilde güncellendi ve aynı noktalar yaz görüntüsüyle (Haziran 2025) yeniden analiz edildi: **6 alarmın 6'sı da kalktı.**
- **Hafriyat tespiti:** Hafriyatın açıkça görünür olduğu bir döküm alanında (Arnavutköy) sistem dökümü **%95 güvenle** tespit etti.

**Bu sonuçları okurken:**
- Örneklem küçük ve sadece **1 pozitif örnek** içeriyor; %100 doğruluk, sistemin her dökümü yakalayacağı anlamına gelmiyor.
- İkinci turda talimat, karşılaştırma tarihi ve model aynı anda değişti; iyileşme bu değişikliklerin toplam etkisidir.

**Öğrendiklerimiz:** Elle seçilen noktalarla havzadaki küçük ölçekli dökümleri bulmak çok zor. Bu, sistemin asıl değerinin **tüm havzanın otomatik taranmasında** olduğunu gösteriyor.

## Neler gerçek, neler henüz yok?

| Gerçekten çalışan | Henüz prototipte olmayan |
| --- | --- |
| Gerçek uydu görüntüleri (Esri Wayback) | Tüm havzanın otomatik taranması |
| Gemini ile görüntü karşılaştırma ve sınıflandırma | Sentinel-2 ile geniş alan değişim katmanı |
| OpenStreetMap'ten gerçek göl sınırı ve göle mesafe | İSKİ / İBB sistemlerine otomatik bildirim |
| Öncelik puanı ve koruma bandı | Yasal döküm sahalarının (izin verisi) ayıklanması |
| Aynı noktayı farklı tarihlerle karşılaştırma | Kamyon GPS verisiyle çapraz kontrol |
| Doğrulama ve doğruluk istatistikleri | Saha doğrulaması |

## Bilinen sınırlamalar

- **Görüntü güncelliği:** Esri her bölgeyi her yıl güncellemiyor. Seçilen tarihten sonra yeni görüntü yoksa sistem karşılaştırma yapmaz ve kullanıcıyı uyarır.
- **Yayın tarihi ≠ çekim tarihi:** Wayback tarihleri görüntünün yayımlandığı tarihtir; fotoğraf daha önce çekilmiş olabilir.
- **Analiz alanı:** Gemini, tıklanan noktayı içeren yaklaşık 230 m × 230 m'lik kareye bakar; nokta karenin ortasında olmayabilir ve çok küçük dökümler gözden kaçabilir.
- **Yasal / kaçak ayrımı:** Uydudan bakınca yasal döküm sahası ile kaçak döküm aynı görünür. Ayrım için İBB'nin izinli saha verisiyle eşleştirme gerekir.
- **Öncelik puanı tek havzaya göre:** Göle mesafe sadece Büyükçekmece Gölü'ne göre hesaplanıyor. Uzun vadede her nokta en yakın içme suyu kaynağına göre puanlanmalı.
- **Koruma bandı yaklaşıktır:** Mesafe OpenStreetMap kıyı çizgisinden ölçülür; yönetmelik ise maksimum su seviyesini esas alır.

## Küresel gündemle bağlantı

- **COP31 hedefi:** Atığı 2035'e kadar yarıya indirmek
- **Siemens etki alanı:** Resource Efficiency & Circularity
- **BM Sürdürülebilir Kalkınma Amaçları:** SDG 6 (Temiz Su ve Sanitasyon), SDG 12 (Sorumlu Tüketim ve Üretim)

## Teknoloji

- **Ön yüz:** HTML, CSS, JavaScript, [Leaflet](https://leafletjs.com/), [Turf.js](https://turfjs.org/)
- **Sunucu:** Netlify Functions (Node.js)
- **Yapay zekâ:** Google Gemini API (görüntü analizi, yapılandırılmış JSON çıktı)
- **Veri:** Esri World Imagery ve World Imagery Wayback, OpenStreetMap (Overpass API ile göl sınırı, Nominatim ile yer arama)
- **Geliştirme:** Cursor, Claude

## Yerelde çalıştırma

Gereksinim: Node.js 18 veya üstü.

```bash
git clone https://github.com/tubakoten/havza-bekcisi.git
cd havza-bekcisi
cp .env.example .env   # ardından .env dosyasına Gemini API anahtarını yaz
npx netlify-cli dev
```

Uygulama `http://localhost:8888` adresinde açılır.

### Ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/)'dan alınan API anahtarı |
| `GEMINI_MODEL` | Ana model (ör. `gemini-2.5-flash`) |
| `GEMINI_FALLBACK_MODEL` | Ana model yoğunsa kullanılan yedek model |

## Proje yapısı

```
havza-bekcisi/
├── netlify.toml
├── package.json
├── netlify/functions/
│   ├── analyze.mjs        # Görüntüleri indirir, Gemini ile karşılaştırır
│   └── releases.mjs       # Wayback tarih listesini getirir
└── public/
    ├── index.html
    ├── style.css
    ├── app.js             # Harita, analiz, önceliklendirme, test istatistikleri
    └── test-results.json  # Siteye gömülü ön test sonuçları
```

## Kaynaklar ve lisanslar

- Uydu görüntüleri: © Esri, Maxar, Earthstar Geographics ve GIS kullanıcı topluluğu (World Imagery, World Imagery Wayback)
- Harita verisi: © [OpenStreetMap](https://www.openstreetmap.org/copyright) katkıcıları, ODbL lisansı
- Yapay zekâ analizi: Google Gemini

Bu bir prototiptir; sonuçlar sahada doğrulanmalıdır.
