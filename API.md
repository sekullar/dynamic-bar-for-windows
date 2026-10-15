# Dynamic Bar API (ekosistem)

Dynamic Bar, bu bilgisayardaki her programın bildirim gösterebileceği küçük bir yerel sunucu açar.
Adres: `http://127.0.0.1:47800` (WebSocket: `ws://127.0.0.1:47800`). Yalnızca bu bilgisayardan erişilir;
tarayıcıdan (Origin başlığı olan) ve yanlış Host başlıklı istekler reddedilir. Ayarlardan kapatılabilir veya
**API anahtarı** tanımlanabilir (anahtar varsa `Authorization: Bearer ANAHTAR` veya `?token=ANAHTAR` gerekir).

## Bildirim: `POST /notify`

```json
{ "title": "Deploy", "text": "prod'a çıktı", "icon": "🚀", "mood": "happy", "ttl": 5,
  "app": "CI", "color": "#7ab8f2", "url": "https://github.com/...", "priority": "high" }
```

| Alan | Anlamı |
|---|---|
| `title`, `text` | Başlık ve metin (en çok 80 / 200 karakter) |
| `icon` | Başlığın önünde görünen emoji veya kısa metin |
| `app` | Gönderen uygulama adı; metnin önünde görünür, geçmişte etiketlenir, ayarlardan sessize alınabilir |
| `mood` | `happy`, `alert`, `idle`, `music`, `claude` (maskot Claude Code maskotuna dönüşüp geri döner): maskotun tepkisi |
| `ttl` | Kaç saniye görüneceği (varsayılan 4) |
| `sticky` | `true`: tıklanana veya `/dismiss` gelene kadar (en çok 5 dk) kalır |
| `progress` | 0 ile 1 arası; ilerleme çubuğu gösterir |
| `key` | Aynı `key` ile gelen bildirim yenisini eklemez, görüneni yerinde günceller (canlı ilerleme için) |
| `color` | `#rrggbb`: ilerleme çubuğu rengi |
| `url` | `http(s)://` veya `mailto:`; bildirime tıklanınca açılır |
| `priority` | `high`: rahatsız etmeyi ve sessiz saatleri aşar, sıranın başına geçer |
| `force` | `true`: rahatsız etmeyi aşar (sıra değişmez) |
| `type: "timer"`, `seconds` | Geri sayım bildirimi |

Dizi gönderirsen (en çok 10) hepsi sırayla gösterilir. Saniyede çok fazla istek sınırlanır (5 sn'de 25).

## Diğer uçlar

| İstek | Gövde | Ne yapar |
|---|---|---|
| `POST /dismiss` | `{"key":"..."}` (boşsa hepsi) | Bildirimi kapatır |
| `POST /dnd` | `{"on":true}` (boşsa değiştirir) | Rahatsız etme |
| `POST /panel` | `{"mode":"open\|close\|toggle"}` | Paneli aç/kapat |
| `POST /remind` | `{"minutes":10,"text":"çayı al"}` veya `seconds` | Gecikmeli hatırlatıcı (uygulama kapanınca silinir) |
| `POST /todo` | `{"add":"metin"}`, `{"toggle":0}`, `{"clear":true}` | Yapılacaklar listesi |
| `GET /status` | | `{dnd, focus, quiet, todos, media}` |

## WebSocket

Her metin mesajı bir JSON'dur: düz bildirim (`{"title":"..."}`) veya komut (`{"cmd":"dnd","on":true}`;
`cmd`: `dismiss`, `dnd`, `panel`, `remind`, `todo`). Anahtar varsa `ws://127.0.0.1:47800/?token=ANAHTAR`.

## Komut satırı (`dynbar`)

```
npm link            # bir kez; sonra her yerden "dynbar"
dynbar notify "Bitti" "Build" --icon ✅ --mood happy
dynbar run npm run build                 # bitince başarı/hata + süre bildirir
dynbar progress indirme 40 "%40"         # canlı ilerleme (aynı anahtar güncellenir)
dynbar remind 10m "Çayı al"
dynbar dnd on
dynbar todo add "Faturayı öde"
```
Anahtar tanımladıysan: `set DYNBAR_TOKEN=anahtar` (PowerShell: `$env:DYNBAR_TOKEN="anahtar"`).

## Örnekler

curl:
```
curl -X POST http://127.0.0.1:47800/notify -d '{"title":"Merhaba","text":"curl'den","icon":"👋"}'
```
PowerShell:
```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47800/notify -Body (@{title='Bitti';text='Yedekleme';icon='💾'} | ConvertTo-Json)
```
Python: `integrations/dynbar.py` · Node: `integrations/dynbar.js`

## Claude Code

Claude Code onay beklerken veya işi bitirince bara bildirim gelsin. `~/.claude/settings.json` dosyasına (Windows'ta
`C:\Users\KULLANICI\.claude\settings.json`) ekle, yolu kendi klasörüne göre düzelt:

```json
{
  "hooks": {
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"C:/yol/dynamic-bar/integrations/claude-code-hook.js\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"C:/yol/dynamic-bar/integrations/claude-code-hook.js\"" }] }]
  }
}
```
Claude Code bitince başlık "Claude Code bitirdi", içerik ise son yanıtın en çok 10 kelimelik özeti olur; maskot Claude Code maskotuna dönüşüp geri döner.
Claude Code çalışırken sürekli bildirim istemezsen yalnızca `Notification` bölümünü bırak.

## Fikirler

- Uzun işlerin sonuna `&& dynbar notify "bitti"` ekle veya `dynbar run <komut>` kullan.
- Git: `.git/hooks/post-merge` içine `dynbar notify "Çekildi" "git" --app git`.
- Oyun sunucusu (open.mp, Node, Discord botu): olay olunca `notify` gönder (oyuncu girdi, sunucu çöktü).
- Sentinel/Jarvis: durumunu `key: "jarvis"` ile güncelle ("dinliyor", "düşünüyor", yanıt).
- Zamanlanmış görev: Windows Görev Zamanlayıcı ile `dynbar remind` veya `dynbar notify`.

## Claude Code: canlı durum, bardan onay, özet

`integrations/claude-code-hook.js` şu olayları dinler: `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Notification`, `Stop`.
`~/.claude/settings.json` içinde her biri için aynı komut tanımlanır (yukarıdaki örnekteki gibi).

- **Canlı durum:** Claude çalışırken maskot laptop açıp kod yazar, barda "Kod yazıyor · main.js" gibi durum görünür (`key: "claude"`, `mood: "working"`). Diğer bildirimler önüne geçer, bitince geri gelir.
- **Bardan onay:** izin istenince Onayla / Reddet düğmeleri çıkar. Yanıtlamazsan (60 sn) veya terminalden yanıtlarsan terminaldeki soru geçerli kalır.
  Uç: `POST /ask {"title","text","timeout"}` yanıt `{"answer":"allow|deny|dismissed|timeout|unavailable|closed"}` olana kadar bekler.
- **Özet:** `Stop` olayında son yanıt `claude -p --model haiku` ile 10 kelimeye özetlenir; olmazsa ilk cümleden çıkarılır.
  Hata varsa başlık "Claude Code takıldı" ve maskot üzgün (`mood: "sad"`).
- Üç özellik de Ayarlar > Claude Code bölümünden kapatılabilir. Günlük: tray > "Günlüğü aç".
