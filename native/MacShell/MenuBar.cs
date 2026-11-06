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
    string openId; int hot = -1; bool pressed;
    ID2D1SolidColorBrush br; IDWriteTextFormat fmt, fmtBold; ID2D1StrokeStyle round;
    record struct Btn(string Id, float X, float W, string Kind, int I, string Label);
    readonly List<Btn> btns = new();
    int batPct = -1; bool charging, online = true; string clock = ""; DateTime lastInfo = DateTime.MinValue;
    static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");
    const float BH = 21, Y0 = 2;

    public MenuWindow(int x, int y, int w, int h) : base("MacShell Menu", x, y, w, h) { }
    public void SetOpen(string id) { openId = id; Dirty = true; }
    public void ClearOpen() { openId = null; Dirty = true; }
    public override bool Animating => hot >= 0;
    protected override void OnResize() { }

    float TextW(string s, bool bold)
    {
        using var l = Gfx.DW.CreateTextLayout(s, bold ? fmtBold : fmt, 800, 25); return l.Metrics.WidthIncludingTrailingWhitespace;
    }

    void Info()
    {
        if ((DateTime.Now - lastInfo).TotalSeconds < 5 && lastInfo != DateTime.MinValue) { clock = DateTime.Now.ToString("d MMM ddd HH:mm", Tr).Replace(".", ""); return; }
        lastInfo = DateTime.Now; clock = DateTime.Now.ToString("d MMM ddd HH:mm", Tr).Replace(".", "");
        try { online = System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable(); } catch { }
        if (N.GetSystemPowerStatus(out var ps) && (ps.BatteryFlag & 128) == 0 && ps.BatteryLifePercent <= 100) { batPct = ps.BatteryLifePercent; charging = (ps.BatteryFlag & 8) != 0 || (ps.ACLineStatus == 1 && ps.BatteryLifePercent < 100 && (ps.BatteryFlag & 8) != 0); if (ps.ACLineStatus == 1 && ps.BatteryLifePercent < 100) charging = true; }
        else batPct = -1;
    }

    void LayoutBtns()
    {
        btns.Clear(); float x = 6;
        btns.Add(new Btn("start", x, 30, "apple", 0, "")); x += 30;
        float maxX = W / 2 - 94 - 6;
        foreach (var m in Menus)
        {
            bool b = m.Kind == "app"; float w = TextW(m.Label, b) + 16;
            if (x + w > maxX) break; btns.Add(new Btn("m" + m.I + m.Kind + m.Label, x, w, m.Kind, m.I, m.Label)); x += w;
        }
        float rx = W - 6;
        float cw = TextW(clock, false) + 16; rx -= cw; btns.Add(new Btn("clock", rx, cw, "panel", 0, ""));
        rx -= 32; btns.Add(new Btn("cc", rx, 32, "cc", 0, ""));
        if (batPct >= 0) { float bw = TextW(batPct + "%", false) + 5 + 27 + 16; rx -= bw; btns.Add(new Btn("bat", rx, bw, "bat", 0, "")); }
        rx -= 34; btns.Add(new Btn("wifi", rx, 34, "wifi", 0, ""));
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
        fmt ??= Gfx.Text(13, FontWeight.Medium); fmtBold ??= Gfx.Text(13, FontWeight.Bold);
        round ??= Gfx.D2D.CreateStrokeStyle(new StrokeStyleProperties { StartCap = CapStyle.Round, EndCap = CapStyle.Round, LineJoin = LineJoin.Round });
        Info(); LayoutBtns();
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
                case "wifi": Wifi(cx, cy, fg, shadowC, online ? 1f : .45f); break;
                case "cc": Cc(cx, cy, fg, shadowC); break;
                case "bat": Battery(b, fg); break;
                case "clock": Text(clock, b.X + 8, b.W, false, fg); break;
                default: Text(b.Label, b.X + 8, b.W, b.Kind == "app", fg); break;
            }
        }
        Dc.Transform = Matrix3x2.Identity;
    }

    void WinLogo(float cx, float cy, Color4 fg)
    {
        float s = 14f / 16f; Dc.Transform = Matrix3x2.CreateScale(s) * Matrix3x2.CreateTranslation(cx - 7, cy - 7);
        foreach (var (dx, dy, c, a) in new[] { (0f, 1f, shadowOf(), .45f) , (0f, 0f, fg, 1f) })
            for (int q = 0; q < 4; q++)
            {
                float x = (q % 2) * 8.6f + dx * .0f, y = (q / 2) * 8.6f + dy * .0f; if (dy == 1f) { y += 1f; }
                br.Color = new Color4(c.R, c.G, c.B, a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(x, y, x + 7.4f, y + 7.4f), .6f, .6f), br);
            }
        Dc.Transform = Matrix3x2.Identity;
        Color4 shadowOf() => new Color4(0, 0, 0, 1);
    }
    void Wifi(float cx, float cy, Color4 fg, Color4 sh, float op)
    {
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7);
        using var a = Arc(1.6f, 5.2f, 16.4f, 5.2f, 10.6f); using var b = Arc(4.2f, 7.9f, 13.8f, 7.9f, 7); using var c = Arc(6.7f, 10.4f, 11.3f, 10.4f, 3.5f);
        br.Color = new Color4(sh.R, sh.G, sh.B, sh.A * .8f * op); Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7 + .6f);
        Dc.DrawGeometry(a, br, 1.8f, round); Dc.DrawGeometry(b, br, 1.8f, round); Dc.DrawGeometry(c, br, 1.8f, round);
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 9, cy - 7); br.Color = new Color4(fg.R, fg.G, fg.B, op);
        Dc.DrawGeometry(a, br, 1.8f, round); Dc.DrawGeometry(b, br, 1.8f, round); Dc.DrawGeometry(c, br, 1.8f, round);
        Dc.FillEllipse(new Ellipse(new Vector2(9, 12.4f), .95f, .95f), br); Dc.Transform = Matrix3x2.Identity;
    }
    void Cc(float cx, float cy, Color4 fg, Color4 sh)
    {
        Dc.Transform = Matrix3x2.CreateTranslation(cx - 8, cy - 7); br.Color = fg;
        Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(.6f, .6f, 15.4f, 5.8f), 2.6f, 2.6f), br, 1.2f); Dc.FillEllipse(new Ellipse(new Vector2(4, 3.2f), 1.7f, 1.7f), br);
        Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(.6f, 8.2f, 15.4f, 13.4f), 2.6f, 2.6f), br, 1.2f); Dc.FillEllipse(new Ellipse(new Vector2(12, 10.8f), 1.7f, 1.7f), br);
        Dc.Transform = Matrix3x2.Identity;
    }
    void Battery(Btn b, Color4 fg)
    {
        string pct = batPct + "%"; Text(pct, b.X + 8, b.W, false, fg);
        float bx = b.X + b.W - 8 - 27, by = H / 2 - 6.5f;
        Dc.Transform = Matrix3x2.CreateTranslation(bx, by);
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
        Dc.Transform = Matrix3x2.Identity;
    }

    // ---- girdi ----
    int Hit(float x, float y) { if (y < Y0 || y > Y0 + BH) return -1; for (int i = 0; i < btns.Count; i++) if (x >= btns[i].X && x <= btns[i].X + btns[i].W) return i; return -1; }
    public void Poll()
    {
        if (hot < 0) return; var c = CursorDip(); int h = Hit(c.X, c.Y);
        if (h != hot) { hot = h; pressed = false; Dirty = true; }
    }
    protected override IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled)
    {
        handled = true;
        switch (m)
        {
            case N.WM_NCHITTEST:
                {
                    float x = (N.Lo(l) - PxX) / Scale, y = (N.Hi(l) - PxY) / Scale; int h = Hit(x, y);
                    if (h >= 0) { if (hot != h) { hot = h; Track(); Dirty = true; Emit?.Invoke("macmenu:hover", null); } return (IntPtr)N.HTCLIENT; }
                    if (hot >= 0) { hot = -1; Dirty = true; }
                    return (IntPtr)N.HTTRANSPARENT;
                }
            case N.WM_MOUSEACTIVATE: return (IntPtr)N.MA_NOACTIVATE;
            case N.WM_MOUSEMOVE: { int h = Hit(N.Lo(l) / Scale, N.Hi(l) / Scale); if (h != hot) { hot = h; Dirty = true; } Track(); return IntPtr.Zero; }
            case N.WM_MOUSELEAVE: Untrack(); hot = -1; pressed = false; Dirty = true; return IntPtr.Zero;
            case N.WM_LBUTTONDOWN:
                {
                    int h = Hit(N.Lo(l) / Scale, N.Hi(l) / Scale); if (h < 0) return IntPtr.Zero; var b = btns[h]; pressed = true; Dirty = true;
                    if (b.Id == "clock") { Emit?.Invoke("macmenu:panel", null); return IntPtr.Zero; }
                    if (b.Id == "bat") return IntPtr.Zero;
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
