using System.Globalization;
using System.Numerics;
using Vortice;
using Vortice.Direct2D1;
using Vortice.DCommon;
using Vortice.DirectWrite;
using Vortice.Mathematics;

namespace MacShell;

class MenuEntry { public string Kind, Label, Title; public int I; }

/// <summary>macOS tarzı menü çubuğu: şeffaf, yazı rengi duvar kağıdına göre beyaz/siyah.</summary>
class MenuWindow : Surface
{
    public List<MenuEntry> Menus = new(); public bool Light = true; public Action<string, object> Emit;
    public bool AutoHide, PopOpen; public float Ease = .25f; float shown = 1f, shownT = 1f; DateTime leaveAt = DateTime.MinValue; Matrix3x2 Tb = Matrix3x2.Identity;
    public float IslandHalf = 104; public List<(string L, int I)> Hm = new(); public Action<int, float, float, string> OpenHm;
    string openId; int hot = -1; bool pressed;
    ID2D1SolidColorBrush br; IDWriteTextFormat fmt, fmtBold; ID2D1StrokeStyle round;
    record struct Btn(string Id, float X, float W, string Kind, int I, string Label);
    readonly List<Btn> btns = new();
    int batPct = -1; bool charging, online = true; string clock = ""; DateTime lastInfo = DateTime.MinValue;
    static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");
    const float BH = 21, Y0 = 2;

    public MenuWindow(int x, int y, int w, int h) : base("MacShell Menu", x, y, w, h) { }
    public void SetOpen(string id) { openId = id; Dirty = true; }
    public void ClearOpen() { openId = null; PopOpen = false; Dirty = true; }
    public bool OverBar() { N.GetCursorPos(out var p); return p.Y >= PxY && p.Y < PxY + PxH * Math.Max(shown, .01f) && p.X >= PxX && p.X < PxX + PxW && p.Y < PxY + (int)((Y0 + BH + 3) * Scale); }
    public override bool Animating => hot >= 0 || shown != shownT;
    protected override void OnResize() { }

    float TextW(string s, bool bold)
    {
        using var l = Gfx.DW.CreateTextLayout(s, bold ? fmtBold : fmt, 800, 25); return l.Metrics.WidthIncludingTrailingWhitespace;
    }

    void Info()
    {
        if ((DateTime.Now - lastInfo).TotalSeconds < 5 && lastInfo != DateTime.MinValue) { clock = DateTime.Now.ToString("ddd d MMM HH:mm", Tr).Replace(".", ""); return; }
        lastInfo = DateTime.Now; clock = DateTime.Now.ToString("ddd d MMM HH:mm", Tr).Replace(".", "");
        try { online = System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable(); } catch { }
        if (N.GetSystemPowerStatus(out var ps) && (ps.BatteryFlag & 128) == 0 && ps.BatteryLifePercent <= 100) { batPct = ps.BatteryLifePercent; charging = (ps.BatteryFlag & 8) != 0 || (ps.ACLineStatus == 1 && ps.BatteryLifePercent < 100 && (ps.BatteryFlag & 8) != 0); if (ps.ACLineStatus == 1 && ps.BatteryLifePercent < 100) charging = true; }
        else batPct = -1;
    }

    void LayoutBtns()
    {
        btns.Clear(); float x = 6;
        x = 4; btns.Add(new Btn("start", x, 34, "apple", 0, "")); x += 34;
        float maxX = W / 2 - IslandHalf;
        var all = new List<(string Kind, int I, string Label)>();
        foreach (var m in Menus) if (m.Kind != "win") all.Add((m.Kind, m.I, m.Label));
        foreach (var h in Hm) all.Add(("hm", h.I, h.L));
        foreach (var m in Menus) if (m.Kind == "win") all.Add((m.Kind, m.I, m.Label));
        foreach (var m in all)
        {
            bool b = m.Kind == "app"; float w = TextW(m.Label, b) + 20;
            if (x + w > maxX) break; btns.Add(new Btn("m" + m.I + m.Kind + m.Label, x, w, m.Kind, m.I, m.Label)); x += w;
        }
        float rx = W - 6, minX = W / 2 + IslandHalf; // sağ küme de adanın arkasına girmez; sığmayanlar atılır
        float cw = TextW(clock, false) + 16; rx -= cw; btns.Add(new Btn("clock", rx, cw, "panel", 0, ""));
        if (rx - 32 >= minX) { rx -= 32; btns.Add(new Btn("cc", rx, 32, "cc", 0, "")); }
        if (batPct >= 0) { float bw = TextW(batPct + "%", false) + 5 + 27 + 16; if (rx - bw >= minX) { rx -= bw; btns.Add(new Btn("bat", rx, bw, "bat", 0, "")); } }
        if (rx - 34 >= minX) { rx -= 34; btns.Add(new Btn("wifi", rx, 34, "wifi", 0, "")); }
        if (rx - 28 >= minX) { rx -= 28; btns.Add(new Btn("tray", rx, 28, "tray", 0, "")); }
    }

    static ID2D1PathGeometry Arc(float x1, float y1, float x2, float y2, float r)
    {
        var g = Gfx.D2D.CreatePathGeometry(); using var s = g.Open();
        s.BeginFigure(new Vector2(x1, y1), FigureBegin.Hollow);
        s.AddArc(new ArcSegment { Point = new Vector2(x2, y2), Size = new Vortice.Mathematics.Size(r, r), RotationAngle = 0, SweepDirection = SweepDirection.Clockwise, ArcSize = ArcSize.Small });
        s.EndFigure(FigureEnd.Open); s.Close(); return g;
    }

    void Text(string s, float x, float w, bool bold, Color4 fg)
    {
        using var l = Gfx.DW.CreateTextLayout(s, bold ? fmtBold : fmt, 800, 25);
        float y = (H - l.Metrics.Height) / 2 + .5f;
        var sh = Light ? new Color4(0, 0, 0, .28f) : new Color4(1, 1, 1, .28f);
        br.Color = sh; Dc.DrawTextLayout(new Vector2(x, y + .7f), l, br);
        br.Color = fg; Dc.DrawTextLayout(new Vector2(x, y), l, br);
    }

    public override void Draw()
    {
        br ??= Dc.CreateSolidColorBrush(new Color4(1, 1, 1, 1));
        fmt ??= Gfx.Text(13, FontWeight.Medium); fmtBold ??= Gfx.Text(13, FontWeight.SemiBold);
        round ??= Gfx.D2D.CreateStrokeStyle(new StrokeStyleProperties { StartCap = CapStyle.Round, EndCap = CapStyle.Round, LineJoin = LineJoin.Round });
        Info(); LayoutBtns();
        Dc.Transform = Tb;
        var fg = Light ? new Color4(1, 1, 1, 1) : new Color4(0, 0, 0, 1);
        var shadowC = Light ? new Color4(0, 0, 0, .35f) : new Color4(1, 1, 1, .35f);
        for (int i = 0; i < btns.Count; i++)
        {
            var b = btns[i]; bool isOpen = openId == b.Id, h = i == hot;
            if (isOpen || (h && pressed)) { br.Color = new Color4(.5f, .5f, .5f, .4f); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(b.X, Y0, b.X + b.W, Y0 + BH), 7, 7), br); }
            else if (h) { br.Color = new Color4(.5f, .5f, .5f, .28f); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(b.X, Y0, b.X + b.W, Y0 + BH), 7, 7), br); }
            float cx = b.X + b.W / 2, cy = H / 2;
            switch (b.Id)
            {
                case "start": WinLogo(cx, cy, fg); break;
                case "tray": Tray(cx, cy, fg); break;
                case "wifi": Wifi(cx, cy, fg, shadowC, online ? 1f : .45f); break;
                case "cc": Cc(cx, cy, fg, shadowC); break;
                case "bat": Battery(b, fg); break;
                case "clock": Text(clock, b.X + 8, b.W, false, fg); break;
                default: Text(b.Label, b.X + 8, b.W, b.Kind == "app", fg); break;
            }
        }
        Dc.Transform = Tb;
    }

    void Tray(float cx, float cy, Color4 fg)
    {
        br.Color = fg; Dc.DrawLine(new Vector2(cx - 4, cy + 2), new Vector2(cx, cy - 2), br, 1.6f, round); Dc.DrawLine(new Vector2(cx, cy - 2), new Vector2(cx + 4, cy + 2), br, 1.6f, round);
    }
    static void TrayFlyout() // Windows'un gizli simgeler (sistem tepsisi) paneli: Win+B, ardından Enter
    {
        Task.Run(() => { N.keybd_event(0x5B, 0, 0, 0); N.keybd_event(0x42, 0, 0, 0); N.keybd_event(0x42, 0, 2, 0); N.keybd_event(0x5B, 0, 2, 0); Thread.Sleep(350); N.keybd_event(0x0D, 0, 0, 0); N.keybd_event(0x0D, 0, 2, 0); });
    }
    void WinLogo(float cx, float cy, Color4 fg)
    { // Windows 11 logosu: dört eşit kare, ince boşluk; piksele oturtulmuş (keskin)
        float sz = 14f, gap = 1.5f, q = (sz - gap) / 2, x0 = MathF.Round((cx - sz / 2) * Scale) / Scale, y0 = MathF.Round((cy - sz / 2 - .5f) * Scale) / Scale;
        br.Color = fg;
        for (int i = 0; i < 4; i++) { float x = x0 + (i % 2) * (q + gap), y = y0 + (i / 2) * (q + gap); Dc.FillRectangle(new RawRectF(x, y, x + q, y + q), br); }
    }
    void Wifi(float cx, float cy, Color4 fg, Color4 sh, float op)
    {
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7) * Tb;
        using var a = Arc(1.6f, 5.2f, 16.4f, 5.2f, 10.6f); using var b = Arc(4.2f, 7.9f, 13.8f, 7.9f, 7); using var c = Arc(6.7f, 10.4f, 11.3f, 10.4f, 3.5f);
        br.Color = new Color4(sh.R, sh.G, sh.B, sh.A * .8f * op); Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7 + .6f) * Tb;
        Dc.DrawGeometry(a, br, 1.8f, round); Dc.DrawGeometry(b, br, 1.8f, round); Dc.DrawGeometry(c, br, 1.8f, round);
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7) * Tb; br.Color = new Color4(fg.R, fg.G, fg.B, op);
        Dc.DrawGeometry(a, br, 1.8f, round); Dc.DrawGeometry(b, br, 1.8f, round); Dc.DrawGeometry(c, br, 1.8f, round);
        Dc.FillEllipse(new Ellipse(new Vector2(9, 12.4f), .95f, .95f), br); Dc.Transform = Tb;
    }
    void Cc(float cx, float cy, Color4 fg, Color4 sh)
    {
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 8, cy - 7) * Tb; br.Color = fg;
        Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(.6f, .6f, 15.4f, 5.8f), 2.6f, 2.6f), br, 1.2f); Dc.FillEllipse(new Ellipse(new Vector2(4, 3.2f), 1.7f, 1.7f), br);
        Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(.6f, 8.2f, 15.4f, 13.4f), 2.6f, 2.6f), br, 1.2f); Dc.FillEllipse(new Ellipse(new Vector2(12, 10.8f), 1.7f, 1.7f), br);
        Dc.Transform = Tb;
    }
    void Battery(Btn b, Color4 fg)
    {
        string pct = batPct + "%"; Text(pct, b.X + 8, b.W, false, fg);
        float bx = b.X + b.W - 8 - 27, by = H / 2 - 6.5f;
        Dc.Transform = Matrix3x2.CreateTranslation(bx, by) * Tb;
        br.Color = new Color4(fg.R, fg.G, fg.B, .5f); Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(.6f, .6f, 23f, 12.4f), 3.5f, 3.5f), br, 1.2f);
        float lvl = Math.Max(0.07f, batPct / 100f);
        br.Color = charging ? new Color4(.188f, .82f, .345f, 1) : batPct <= 20 ? new Color4(1, .27f, .227f, 1) : fg;
        Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(2.2f, 2.2f, 2.2f + 19.2f * lvl, 10.8f), 2.1f, 2.1f), br);
        br.Color = new Color4(fg.R, fg.G, fg.B, .55f); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(24.6f, 4.2f, 26.3f, 8.8f), .8f, .8f), br);
        if (charging)
        {
            using var g = Gfx.D2D.CreatePathGeometry(); using (var s = g.Open())
            {
                s.BeginFigure(new Vector2(13.4f, 1.6f), FigureBegin.Filled);
                foreach (var p in new[] { new Vector2(8.2f, 7.1f), new Vector2(11.5f, 7.1f), new Vector2(10.4f, 11.4f), new Vector2(15.8f, 5.8f), new Vector2(12.4f, 5.8f) }) s.AddLine(p);
                s.EndFigure(FigureEnd.Closed); s.Close();
            }
            br.Color = new Color4(0, 0, 0, .55f); Dc.DrawGeometry(g, br, 1.6f, round);
            br.Color = new Color4(1, 1, 1, 1); Dc.FillGeometry(g, br);
        }
        Dc.Transform = Tb;
    }

    // ---- girdi ----
    int Hit(float x, float y) { if (y < Y0 || y > Y0 + BH) return -1; for (int i = 0; i < btns.Count; i++) if (x >= btns[i].X && x <= btns[i].X + btns[i].W) return i; return -1; }
    public void Poll()
    {
        if (AutoHide)
        {
            N.GetCursorPos(out var p); bool atTop = p.Y <= PxY + 1 && p.X >= PxX && p.X < PxX + PxW, inBar = shown > .5f && p.Y >= PxY && p.Y < PxY + PxH && p.X >= PxX && p.X < PxX + PxW;
            bool want = atTop || inBar || PopOpen || openId != null || hot >= 0; if (want) leaveAt = DateTime.UtcNow.AddMilliseconds(350);
            shownT = want || DateTime.UtcNow < leaveAt ? 1f : 0f;
            if (shown != shownT) { shown += (shownT - shown) * Ease; if (MathF.Abs(shownT - shown) < .01f) shown = shownT; Dirty = true; }
        }
        else if (shown != 1f) { shown = shownT = 1f; Dirty = true; }
        Tb = Matrix3x2.CreateTranslation(0, -(1 - shown) * (H + 2));
        if (hot < 0) return; var c = CursorDip(); int hh = Hit(c.X, c.Y);
        if (hh != hot) { hot = hh; pressed = false; Dirty = true; HoverOpen(); }
    }
    void HoverOpen()
    {
        if (!PopOpen || hot < 0 || hot >= btns.Count) return; var b = btns[hot];
        if (b.Kind == "hm" && openId != b.Id) { openId = b.Id; OpenHm?.Invoke(b.I, b.X, b.W, b.Label); return; }
        if ((b.Kind == "apple" || b.Kind == "app" || b.Kind == "win") && openId != b.Id) { openId = b.Id; Emit?.Invoke("macmenu:open", new { kind = b.Kind, x = b.X, w = b.W, i = b.I, label = b.Label }); }
    }
    protected override IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled)
    {
        handled = true;
        switch (m)
        {
            case N.WM_NCHITTEST:
                {
                    float x = (N.Lo(l) - PxX) / Scale, y = (N.Hi(l) - PxY) / Scale; int h = AutoHide && shown < .5f ? -1 : Hit(x, y);
                    if (h >= 0) { if (hot != h) { hot = h; Track(); Dirty = true; Emit?.Invoke("macmenu:hover", null); HoverOpen(); } return (IntPtr)N.HTCLIENT; }
                    if (hot >= 0) { hot = -1; Dirty = true; }
                    return (IntPtr)N.HTTRANSPARENT;
                }
            case N.WM_MOUSEACTIVATE: return (IntPtr)N.MA_NOACTIVATE;
            case N.WM_MOUSEMOVE: { int h = Hit(N.Lo(l) / Scale, N.Hi(l) / Scale); if (h != hot) { hot = h; Dirty = true; HoverOpen(); } Track(); return IntPtr.Zero; }
            case N.WM_MOUSELEAVE: Untrack(); hot = -1; pressed = false; Dirty = true; return IntPtr.Zero;
            case N.WM_LBUTTONDOWN:
                {
                    int h = Hit(N.Lo(l) / Scale, N.Hi(l) / Scale); if (h < 0) return IntPtr.Zero; var b = btns[h]; pressed = true; Dirty = true;
                    if (b.Id == "clock") { Emit?.Invoke("macmenu:panel", null); return IntPtr.Zero; }
                    if (b.Id == "bat") return IntPtr.Zero;
                    if (b.Kind == "tray") { TrayFlyout(); return IntPtr.Zero; }
                    if (b.Kind == "hm") { openId = b.Id; PopOpen = true; OpenHm?.Invoke(b.I, b.X, b.W, b.Label); return IntPtr.Zero; }
                    openId = b.Id;
                    Emit?.Invoke("macmenu:open", new { kind = b.Kind, x = b.X, w = b.W, i = b.I, label = b.Label });
                    return IntPtr.Zero;
                }
            case N.WM_LBUTTONUP: pressed = false; Dirty = true; return IntPtr.Zero;
            case N.WM_ERASEBKGND: return (IntPtr)1;
        }
        handled = false; return IntPtr.Zero;
    }
}
