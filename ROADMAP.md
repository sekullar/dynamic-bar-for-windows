# Dynamic Bar: yol haritası

## v0.4 (bu sürüm)
- **Claude Code entegrasyonu:** canlı durum (laptop maskotu), bardan onay (`POST /ask`), Haiku özeti, hata maskotu, günlük özet sayfası, `dynbar setup-claude`.
- **Maskot yaşamı:** esneme, acıkma, uykulu; su içme hatırlatıcısı (İçtim düğmesi, hedef, seri); toplantı modu.
- **Tıklama:** pencere ada şekline kırpılır (`setShape`), masaüstü geçişlerinde bozulmaz; arayüz tuş basışını almazsa ana süreç tıklamayı iletir.
- **Altyapı:** hata günlüğü (`log.txt`), paketleme (electron-builder), README ve lisans.

## v0.3
- **Win+D / 4 parmakla masaüstüne dönünce tıklama ve kapanma:** tıklama bölgesi durumu artık periyodik yeniden uygulanıyor, masaüstü geçişinde art arda toparlanıyor; işlemler `click` yerine `mousedown` ile çalışıyor; panelin otomatik kapanması fare olaylarına değil ana süreçten gelen imleç konumuna dayanıyor.
- **Ekosistem API'si** (bkz. `API.md`): token, simge, uygulama adı, renk, url, sticky, öncelik, `/dismiss`, `/dnd`, `/panel`, `/remind`, `/todo`, `/status`, WebSocket komutları, hız sınırı, Host/Origin denetimi.
- **Entegrasyonlar:** `dynbar run`, `dynbar progress`, Claude Code hook'u, Node ve Python istemcileri.
- **Yeni sayfalar:** yapılacaklar, son dosyalar, geri sayım, dünya saatleri, döviz.
- **Odak modu:** Pomodoro odak turunda bildirimler bekletilir, tur bitince "kaçırdıkların" özetlenir.
- **Diğer:** bildirim sesi, uygulama sessize alma, ayarları yedekleme/yükleme, panodaki metni yapılacaklara ekleme (tray).

## Sonraki adımlar
1. Hata günlüğü (`userData/log.txt`) ve tray'de tanılama menüsü; PowerShell süreçleri çökerse otomatik yeniden başlatma.
2. Windows bildirimlerini yakalama: `UserNotificationListener` paket kimliği ister, bu yüzden uygulamanın paketlenmesine bağlı.
3. Gerçek RRULE desteği (BYDAY, aylık) ve takvimde birden çok ICS.
4. Eylem düğmeli bildirimler (Onayla / Reddet) ve yanıt için yerel geri çağırma.
5. Sayfa kayıt sistemi ve ayar şeması: bir özellik eklemek için 4 dosya yerine 1 dosya değişsin.
6. Paketleme: electron-builder, otomatik güncelleme, simge.
7. Medya: kaydırma çubuğuyla ileri/geri sarma ve ses seviyesi (media.ps1'e bağlı).
