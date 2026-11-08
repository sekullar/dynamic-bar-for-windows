using System.Numerics;
using Vortice;
using Vortice.Direct2D1;
using Vortice.DCommon;
using Vortice.DirectWrite;
using Vortice.Mathematics;

namespace MacShell;

class PopItem { public string Id, Label, Icon, Sc, RIcon, Ch; public bool Sep, Hd, Checked, Dis, Slider, Media, Keep; public float Value; }

static class WallData { public static ID2D1Bitmap1 Bmp; public static float Iw, Ih, Sw, Sh; }

/// <summary>macOS tarzı açılır panel (menüler, Wi‑Fi, Denetim Merkezi): buzlu cam, mavi seçim, kaydırıcılar, anında açılır.</summary>
class PopWindow : Surface
{
    public Action<string, object> Emit; public Action OnClosed;
    public bool IsOpen; public string Key; public static float Dur = 130;
    List<PopItem> items = new(); bool dark; int hot = -1, armed = -1, dragSl = -1; float pw, ph; float[] ys = Array.Empty<float>();
    DateTime openAt; ID2D1SolidColorBrush br; IDWriteTextFormat fmt, fmtSm, fmtIcon; ID2D1Bitmap1 glass;
    int pl, pt, pr, pb; // panelin ekran pikseli
    int anchorPx, topPx, limitPx; bool anchorRight; float scaleNow = 1;
    const float PAD = 14, VP = 6, IH = 24, SH = 11, HH = 22, SLH = 38, MH = 62, SIDE = 6, RAD = 12;
    int mediaHot = -1, mediaArm = -1; bool anchorCenter; int aboveY;

    public PopWindow(int x, int y, int w, int h) : base("MacShell Pop", x, y, w, h) { SetVisible(false); }
    public override bool Animating => IsOpen && (DateTime.UtcNow - openAt).TotalMilliseconds < Dur + 70;

    void Fmts()
    {
        fmt ??= Gfx.Text(13, FontWeight.Medium); fmtSm ??= Gfx.Text(11, FontWeight.SemiBold);
        if (fmtIcon == null)
        {
            using var sys = Gfx.DW.GetSystemFontCollection(false);
            string fam = sys.FindFamilyName("Segoe Fluent Icons", out _) ? "Segoe Fluent Icons" : "Segoe MDL2 Assets";
            fmtIcon = Gfx.DW.CreateTextFormat(fam, null, FontWeight.Normal, FontStyle.Normal, FontStretch.Normal, 13, "en-us"); fmtIcon.WordWrapping = WordWrapping.NoWrap;
        }
    }
    float TW(string s, IDWriteTextFormat f) { using var l = Gfx.DW.CreateTextLayout(s ?? "", f, 900, 25); return l.Metrics.WidthIncludingTrailingWhitespace; }

    public void Open(List<PopItem> list, string key, bool isDark, int anchor, bool right, int top, int rightLimit, float scale, bool center = false, int above = 0)
    {
        Fmts(); anchorCenter = center; aboveY = above; mediaHot = -1; mediaArm = -1; Key = key; dark = isDark; hot = -1; armed = -1; dragSl = -1; anchorPx = anchor; anchorRight = right; topPx = top; limitPx = rightLimit; scaleNow = scale;
        items = list; Rebuild();
        IsOpen = true; openAt = DateTime.UtcNow; SetVisible(true); Dirty = true;
    }

    /// <summary>İçeriği (konum ve animasyon bozulmadan) yeniler; kaydırıcı sürüklenirken o değere dokunmaz.</summary>
    public void Update(List<PopItem> list)
    {
        if (!IsOpen) return;
        if (dragSl >= 0 && dragSl < list.Count && dragSl < items.Count && list[dragSl].Slider) list[dragSl].Value = items[dragSl].Value;
        bool same = list.Count == items.Count;
        for (int i = 0; same && i < list.Count; i++) same = list[i].Sep == items[i].Sep && list[i].Hd == items[i].Hd && list[i].Slider == items[i].Slider && list[i].Media == items[i].Media && list[i].Label == items[i].Label && list[i].Sc == items[i].Sc;
        if (same) { for (int i = 0; i < list.Count; i++) { if (i != dragSl) items[i].Value = list[i].Value; items[i].Checked = list[i].Checked; items[i].Icon = list[i].Icon; items[i].Dis = list[i].Dis; items[i].Keep = list[i].Keep; } if (dragSl >= 0) { } Dirty = true; return; } // yerleşim aynıysa yeniden kurma (kaydırırken akıcı kalsın)
        items = list; hot = -1; Rebuild(); Dirty = true;
    }

    void Rebuild()
    {
        float scale = scaleNow, mw = 0, y = VP; ys = new float[items.Count]; bool hasSl = false;
        for (int i = 0; i < items.Count; i++)
        {
            var it = items[i]; ys[i] = y;
            if (it.Sep) { y += SH; continue; }
            if (it.Slider) { y += SLH; hasSl = true; continue; }
            if (it.Media) { y += MH; hasSl = true; continue; }
            if (it.Hd) { y += HH; mw = Math.Max(mw, TW(it.Label, fmtSm) + 24); continue; }
            y += IH; mw = Math.Max(mw, TW(it.Label, fmt) + 24 + 24 + 14 + (string.IsNullOrEmpty(it.Sc) ? 0 : TW(it.Sc, fmt) + 28) + (string.IsNullOrEmpty(it.RIcon) && !(it.Checked && !string.IsNullOrEmpty(it.Icon)) ? 0 : 22));
        }
        pw = Math.Max(hasSl ? 270 : 210, mw + SIDE * 2); ph = y + VP;
        int wpx = (int)MathF.Ceiling((pw + PAD * 2) * scale), hpx = (int)MathF.Ceiling((ph + PAD * 2) * scale);
        if (aboveY > 0) topPx = Math.Max(0, aboveY - (int)(ph * scale)); // dock menüsü: alt kenar dock'un üstünde
        int lp = anchorCenter ? anchorPx - (int)(pw * scale / 2) : anchorRight ? anchorPx - (int)(pw * scale) + (int)(4 * scale) : anchorPx;
        lp = Math.Min(lp, limitPx - (int)(pw * scale) - (int)(8 * scale)); lp = Math.Max(lp, 0);
        pl = lp; pt = topPx; pr = lp + (int)(pw * scale); pb = topPx + (int)(ph * scale);
        SetBounds(lp - (int)(PAD * scale), topPx - (int)(PAD * scale), wpx, hpx, scale);
        glass?.Dispose(); glass = null;
        if (WallData.Bmp != null)
        {
            float k = MathF.Max(WallData.Sw / WallData.Iw, WallData.Sh / WallData.Ih), offX = (WallData.Sw - WallData.Iw * k) / 2, offY = (WallData.Sh - WallData.Ih * k) / 2;
            float scrX = pl / scale, scrY = pt / scale;
            glass = Glass.Make(WallData.Bmp, (scrX - offX) / k, (scrY - offY) / k, pw / k, ph / k, pw, ph, RAD, scale, blur: 16, refractOn: false);
        }
    }

    public void Close()
    {
        if (!IsOpen) return; IsOpen = false; hot = -1; dragSl = -1; N.ReleaseCapture(); SetVisible(false); glass?.Dispose(); glass = null; OnClosed?.Invoke();
    }

    public bool InPanelPx(int x, int y) => x >= pl && x <= pr && y >= pt && y <= pb;
    public void Poll(Func<bool> overBar)
    {
        if (!IsOpen) return;
        bool down = (N.GetAsyncKeyState(0x01) & 0x8000) != 0 || (N.GetAsyncKeyState(0x02) & 0x8000) != 0, esc = (N.GetAsyncKeyState(0x1B) & 0x8001) != 0; // kısa basışı da yakala
        if (dragSl >= 0 && (N.GetAsyncKeyState(0x01) & 0x8000) == 0) { dragSl = -1; N.ReleaseCapture(); }
        if ((DateTime.UtcNow - openAt).TotalMilliseconds < 160 && !esc) return;
        N.GetCursorPos(out var p);
        if (esc || (down && dragSl < 0 && !InPanelPx(p.X, p.Y) && !overBar())) Close();
    }

    public override void Draw()
    {
        if (!IsOpen) return; br ??= Dc.CreateSolidColorBrush(new Color4(1, 1, 1, 1)); Fmts();
        float t = Math.Clamp((float)(DateTime.UtcNow - openAt).TotalMilliseconds / Dur, 0, 1), e = 1 - (1 - t) * (1 - t), a = e;
        float s = .97f + .03f * e; Dc.Transform = Matrix3x2.CreateScale(s, s, new Vector2(PAD + (anchorRight ? pw : 0), PAD));
        var r = new RawRectF(PAD, PAD, PAD + pw, PAD + ph);
        for (int i = 5; i >= 1; i--) { br.Color = new Color4(0, 0, 0, (dark ? .07f : .045f) * a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(r.Left - i * 2, r.Top - i * 2 + 4, r.Right + i * 2, r.Bottom + i * 2 + 4), RAD + i * 2, RAD + i * 2), br); }
        var rr = new RoundedRectangle(r, RAD, RAD);
        if (glass != null) Dc.DrawBitmap(glass, r, a, InterpolationMode.Linear, null, null); else { br.Color = dark ? new Color4(.12f, .12f, .14f, .9f * a) : new Color4(.95f, .95f, .97f, .9f * a); Dc.FillRoundedRectangle(rr, br); }
        br.Color = dark ? new Color4(.09f, .09f, .11f, .50f * a) : new Color4(1, 1, 1, .46f * a); Dc.FillRoundedRectangle(rr, br);
        br.Color = dark ? new Color4(1, 1, 1, .18f * a) : new Color4(1, 1, 1, .7f * a); Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(r.Left + .5f, r.Top + .5f, r.Right - .5f, r.Bottom - .5f), RAD - .5f, RAD - .5f), br, 1f);
        var fg = dark ? new Color4(1, 1, 1, .94f) : new Color4(0, 0, 0, .86f);
        for (int i = 0; i < items.Count; i++)
        {
            var it = items[i]; float y = PAD + ys[i];
            if (it.Sep) { br.Color = dark ? new Color4(1, 1, 1, .16f * a) : new Color4(0, 0, 0, .13f * a); Dc.FillRectangle(new RawRectF(r.Left + 10, y + SH / 2, r.Right - 10, y + SH / 2 + 1), br); continue; }
            if (it.Slider) { DrawSlider(it, r, y, fg, a); continue; }
            if (it.Media) { DrawMedia(it, r, y, fg, a); continue; }
            if (it.Hd)
            {
                using var hl = Gfx.DW.CreateTextLayout(it.Label ?? "", fmtSm, pw, 20); br.Color = new Color4(fg.R, fg.G, fg.B, .5f * a);
                Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 12, y + (HH - hl.Metrics.Height) / 2 + 2), hl, br); continue;
            }
            bool on = i == hot && !it.Dis; Color4 c = on ? new Color4(1, 1, 1, a) : new Color4(fg.R, fg.G, fg.B, fg.A * a * (it.Dis ? .4f : 1f));
            if (on) { br.Color = new Color4(.27f, .52f, .98f, a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(r.Left + SIDE, y, r.Right - SIDE, y + IH), 6, 6), br); }
            bool checkRight = it.Checked && !string.IsNullOrEmpty(it.Icon);
            string ic = it.Checked && !checkRight ? "" : it.Icon;
            if (!string.IsNullOrEmpty(ic))
            {
                using var il = Gfx.DW.CreateTextLayout(ic, fmtIcon, 30, 24); br.Color = c;
                Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 9 + (18 - il.Metrics.Width) / 2, y + (IH - il.Metrics.Height) / 2), il, br);
            }
            using var l = Gfx.DW.CreateTextLayout(it.Label ?? "", fmt, pw, 24); br.Color = c;
            Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 36, y + (IH - l.Metrics.Height) / 2), l, br);
            string ri = checkRight ? "" : it.RIcon;
            if (!string.IsNullOrEmpty(ri))
            {
                using var rl = Gfx.DW.CreateTextLayout(ri, fmtIcon, 30, 24); br.Color = new Color4(c.R, c.G, c.B, c.A * (checkRight ? 1f : .6f));
                Dc.DrawTextLayout(new Vector2(r.Right - SIDE - 12 - rl.Metrics.Width, y + (IH - rl.Metrics.Height) / 2), rl, br);
            }
            if (!string.IsNullOrEmpty(it.Sc))
            {
                using var sl = Gfx.DW.CreateTextLayout(it.Sc, fmt, pw, 24); br.Color = new Color4(c.R, c.G, c.B, c.A * (on ? .85f : .5f));
                Dc.DrawTextLayout(new Vector2(r.Right - SIDE - 12 - sl.Metrics.WidthIncludingTrailingWhitespace, y + (IH - sl.Metrics.Height) / 2), sl, br);
            }
        }
        Dc.Transform = Matrix3x2.Identity;
    }

    float MediaX0() => PAD + pw - SIDE - 8 - 3 * 32;
    int MediaHit(float x, float y)
    {
        for (int i = 0; i < items.Count; i++)
        {
            if (!items[i].Media) continue;
            if (y < PAD + ys[i] || y > PAD + ys[i] + MH || x < MediaX0() || x > MediaX0() + 96) return -1;
            return Math.Min(2, (int)((x - MediaX0()) / 32));
        }
        return -1;
    }
    void DrawMedia(PopItem it, RawRectF r, float y, Color4 fg, float a)
    {
        float cy = y + MH / 2, x0 = MediaX0(), tx = r.Left + SIDE + 12;
        Dc.PushAxisAlignedClip(new RawRectF(tx, y, x0 - 4, y + MH), AntialiasMode.Aliased);
        using (var tl = Gfx.DW.CreateTextLayout(it.Label ?? "", fmt, 1000, 24)) { br.Color = new Color4(fg.R, fg.G, fg.B, fg.A * a); Dc.DrawTextLayout(new Vector2(tx, cy - 19), tl, br); }
        using (var al = Gfx.DW.CreateTextLayout(string.IsNullOrEmpty(it.Sc) ? "Şu an çalıyor" : it.Sc, fmtSm, 1000, 20)) { br.Color = new Color4(fg.R, fg.G, fg.B, .55f * a); Dc.DrawTextLayout(new Vector2(tx, cy + 3), al, br); }
        Dc.PopAxisAlignedClip();
        string[] g = { "\uE892", it.Value > .5f ? "\uE769" : "\uE768", "\uE893" };
        for (int k = 0; k < 3; k++)
        {
            float bx = x0 + k * 32;
            if (mediaHot == k) { br.Color = dark ? new Color4(1, 1, 1, .14f * a) : new Color4(0, 0, 0, .10f * a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(bx + 1, cy - 14, bx + 31, cy + 14), 7, 7), br); }
            using var il = Gfx.DW.CreateTextLayout(g[k], fmtIcon, 30, 24); br.Color = new Color4(fg.R, fg.G, fg.B, fg.A * a);
            Dc.DrawTextLayout(new Vector2(bx + (32 - il.Metrics.Width) / 2, cy - il.Metrics.Height / 2), il, br);
        }
    }

    (float L, float R) TrackX() => (PAD + SIDE + 40, PAD + pw - SIDE - 14);
    void DrawSlider(PopItem it, RawRectF r, float y, Color4 fg, float a)
    {
        var (tl, tr) = TrackX(); float cy = y + SLH / 2, v = Math.Clamp(it.Value, 0, 100) / 100f, kx = tl + (tr - tl) * v;
        if (!string.IsNullOrEmpty(it.Icon))
        {
            using var il = Gfx.DW.CreateTextLayout(it.Icon, fmtIcon, 30, 24); br.Color = new Color4(fg.R, fg.G, fg.B, fg.A * a);
            Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 9 + (18 - il.Metrics.Width) / 2, cy - il.Metrics.Height / 2), il, br);
        }
        br.Color = dark ? new Color4(1, 1, 1, .2f * a) : new Color4(0, 0, 0, .14f * a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(tl, cy - 3, tr, cy + 3), 3, 3), br);
        br.Color = new Color4(.27f, .52f, .98f, a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(tl, cy - 3, Math.Max(tl + 6, kx), cy + 3), 3, 3), br);
        br.Color = new Color4(0, 0, 0, .18f * a); Dc.FillEllipse(new Ellipse(new Vector2(kx, cy + 1), 8.5f, 8.5f), br);
        br.Color = new Color4(1, 1, 1, a); Dc.FillEllipse(new Ellipse(new Vector2(kx, cy), 8, 8), br);
    }

    int HitIdx(float x, float y)
    {
        if (x < PAD + SIDE || x > PAD + pw - SIDE) return -1;
        for (int i = 0; i < items.Count; i++) { if (items[i].Sep || items[i].Hd || items[i].Slider || items[i].Media) continue; if (y >= PAD + ys[i] && y < PAD + ys[i] + IH) return i; }
        return -1;
    }
    int SliderAt(float y) { for (int i = 0; i < items.Count; i++) if (items[i].Slider && y >= PAD + ys[i] && y < PAD + ys[i] + SLH) return i; return -1; }
    void Slide(int i, float x)
    {
        var (tl, tr) = TrackX(); float v = Math.Clamp((x - tl) / (tr - tl), 0, 1) * 100f; var it = items[i];
        if (MathF.Abs(v - it.Value) < .5f) return; it.Value = v; Dirty = true; Emit?.Invoke(it.Ch ?? "", (int)MathF.Round(v));
    }

    protected override IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled)
    {
        handled = true;
        switch (m)
        {
            case N.WM_NCHITTEST:
                { int x = N.Lo(l), y = N.Hi(l); return (IntPtr)(IsOpen && InPanelPx(x, y) ? N.HTCLIENT : N.HTTRANSPARENT); }
            case N.WM_MOUSEACTIVATE: return (IntPtr)N.MA_NOACTIVATE;
            case N.WM_MOUSEMOVE:
                {
                    float x = N.Lo(l) / Scale, y = N.Hi(l) / Scale;
                    if (dragSl >= 0) { Slide(dragSl, x); return IntPtr.Zero; }
                    int h = HitIdx(x, y); if (h != hot) { hot = h; Dirty = true; }
                    int mh = MediaHit(x, y); if (mh != mediaHot) { mediaHot = mh; Dirty = true; }
                    Track(); return IntPtr.Zero;
                }
            case N.WM_MOUSELEAVE: Untrack(); if (hot != -1 || mediaHot != -1) { hot = -1; mediaHot = -1; Dirty = true; } return IntPtr.Zero;
            case N.WM_LBUTTONDOWN:
                {
                    float x = N.Lo(l) / Scale, y = N.Hi(l) / Scale; int s = SliderAt(y);
                    if (s >= 0) { dragSl = s; N.SetCapture(Hwnd); Slide(s, x); return IntPtr.Zero; }
                    mediaArm = MediaHit(x, y); armed = HitIdx(x, y); return IntPtr.Zero;
                }
            case N.WM_LBUTTONUP:
                {
                    if (dragSl >= 0) { dragSl = -1; N.ReleaseCapture(); return IntPtr.Zero; }
                    int mk = MediaHit(N.Lo(l) / Scale, N.Hi(l) / Scale);
                    if (mk >= 0 && mk == mediaArm) { Emit?.Invoke("maccc:media", mk == 0 ? "prev" : mk == 1 ? "playpause" : "next"); mediaArm = -1; return IntPtr.Zero; }
                    mediaArm = -1;
                    int h = HitIdx(N.Lo(l) / Scale, N.Hi(l) / Scale);
                    if (h >= 0 && h == armed && !items[h].Dis && items[h].Id != null) { string id = items[h].Id; if (!items[h].Keep) Close(); Emit?.Invoke("macpop:nact", id); }
                    armed = -1; return IntPtr.Zero;
                }
            case N.WM_ERASEBKGND: return (IntPtr)1;
        }
        handled = false; return IntPtr.Zero;
    }

    public override void Dispose() { glass?.Dispose(); base.Dispose(); }
}
