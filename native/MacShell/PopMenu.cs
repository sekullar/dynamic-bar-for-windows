using System.Numerics;
using Vortice;
using Vortice.Direct2D1;
using Vortice.DCommon;
using Vortice.DirectWrite;
using Vortice.Mathematics;

namespace MacShell;

class PopItem { public string Id, Label, Icon, Sc; public bool Sep, Hd, Checked, Dis; }

static class WallData { public static ID2D1Bitmap1 Bmp; public static float Iw, Ih, Sw, Sh; }

/// <summary>macOS tarzı açılır menü (Elma menüsü, uygulama menüsü, Pencere): buzlu cam panel, mavi seçim, anında açılır.</summary>
class PopWindow : Surface
{
    public Action<string, object> Emit; public Action OnClosed;
    public bool IsOpen; public string Key; public static float Dur = 130;
    List<PopItem> items = new(); bool dark; int hot = -1, armed = -1; float pw, ph; float[] ys = Array.Empty<float>();
    DateTime openAt; ID2D1SolidColorBrush br; IDWriteTextFormat fmt, fmtSm, fmtIcon; ID2D1Bitmap1 glass;
    int pl, pt, pr, pb; // panelin ekran pikseli
    const float PAD = 14, VP = 6, IH = 24, SH = 11, HH = 22, SIDE = 6, RAD = 12;

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

    public void Open(List<PopItem> list, string key, bool isDark, int leftPx, int topPx, int rightLimitPx, float scale)
    {
        Fmts(); items = list; Key = key; dark = isDark; hot = -1; armed = -1;
        float mw = 0, y = VP; ys = new float[items.Count];
        for (int i = 0; i < items.Count; i++)
        {
            var it = items[i]; ys[i] = y;
            if (it.Sep) { y += SH; continue; }
            if (it.Hd) { y += HH; mw = Math.Max(mw, TW(it.Label, fmtSm) + 24); continue; }
            y += IH; mw = Math.Max(mw, TW(it.Label, fmt) + 24 + 24 + 14 + (string.IsNullOrEmpty(it.Sc) ? 0 : TW(it.Sc, fmt) + 28));
        }
        pw = Math.Max(210, mw + SIDE * 2); ph = y + VP;
        int wpx = (int)MathF.Ceiling((pw + PAD * 2) * scale), hpx = (int)MathF.Ceiling((ph + PAD * 2) * scale);
        int lp = Math.Min(leftPx, rightLimitPx - (int)(pw * scale) - (int)(8 * scale)); lp = Math.Max(lp, 0);
        pl = lp; pt = topPx; pr = lp + (int)(pw * scale); pb = topPx + (int)(ph * scale);
        SetBounds(lp - (int)(PAD * scale), topPx - (int)(PAD * scale), wpx, hpx, scale);
        glass?.Dispose(); glass = null;
        if (WallData.Bmp != null)
        {
            float k = MathF.Max(WallData.Sw / WallData.Iw, WallData.Sh / WallData.Ih), offX = (WallData.Sw - WallData.Iw * k) / 2, offY = (WallData.Sh - WallData.Ih * k) / 2;
            float scrX = pl / scale, scrY = pt / scale;
            glass = Glass.Make(WallData.Bmp, (scrX - offX) / k, (scrY - offY) / k, pw / k, ph / k, pw, ph, RAD, scale, blur: 16, refractOn: false);
        }
        IsOpen = true; openAt = DateTime.UtcNow; SetVisible(true); Dirty = true;
    }

    public void Close()
    {
        if (!IsOpen) return; IsOpen = false; hot = -1; SetVisible(false); glass?.Dispose(); glass = null; OnClosed?.Invoke();
    }

    public bool InPanelPx(int x, int y) => x >= pl && x <= pr && y >= pt && y <= pb;
    public void Poll(Func<bool> overBar)
    {
        if (!IsOpen) return;
        bool down = (N.GetAsyncKeyState(0x01) & 0x8000) != 0 || (N.GetAsyncKeyState(0x02) & 0x8000) != 0, esc = (N.GetAsyncKeyState(0x1B) & 0x8000) != 0;
        if ((DateTime.UtcNow - openAt).TotalMilliseconds < 160 && !esc) return;
        N.GetCursorPos(out var p);
        if (esc || (down && !InPanelPx(p.X, p.Y) && !overBar())) Close();
    }

    public override void Draw()
    {
        if (!IsOpen) return; br ??= Dc.CreateSolidColorBrush(new Color4(1, 1, 1, 1)); Fmts();
        float t = Math.Clamp((float)(DateTime.UtcNow - openAt).TotalMilliseconds / Dur, 0, 1), e = 1 - (1 - t) * (1 - t), a = e;
        float s = .97f + .03f * e; Dc.Transform = Matrix3x2.CreateScale(s, s, new Vector2(PAD, PAD));
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
            if (it.Hd)
            {
                using var hl = Gfx.DW.CreateTextLayout(it.Label ?? "", fmtSm, pw, 20); br.Color = new Color4(fg.R, fg.G, fg.B, .5f * a);
                Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 12, y + (HH - hl.Metrics.Height) / 2 + 2), hl, br); continue;
            }
            bool on = i == hot && !it.Dis; Color4 c = on ? new Color4(1, 1, 1, a) : new Color4(fg.R, fg.G, fg.B, fg.A * a * (it.Dis ? .4f : 1f));
            if (on) { br.Color = new Color4(.27f, .52f, .98f, a); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(r.Left + SIDE, y, r.Right - SIDE, y + IH), 6, 6), br); }
            string ic = it.Checked ? "" : it.Icon;
            if (!string.IsNullOrEmpty(ic))
            {
                using var il = Gfx.DW.CreateTextLayout(ic, fmtIcon, 30, 24); br.Color = c;
                Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 9 + (18 - il.Metrics.Width) / 2, y + (IH - il.Metrics.Height) / 2), il, br);
            }
            using var l = Gfx.DW.CreateTextLayout(it.Label ?? "", fmt, pw, 24); br.Color = c;
            Dc.DrawTextLayout(new Vector2(r.Left + SIDE + 36, y + (IH - l.Metrics.Height) / 2), l, br);
            if (!string.IsNullOrEmpty(it.Sc))
            {
                using var sl = Gfx.DW.CreateTextLayout(it.Sc, fmt, pw, 24); br.Color = new Color4(c.R, c.G, c.B, c.A * (on ? .85f : .5f));
                Dc.DrawTextLayout(new Vector2(r.Right - SIDE - 12 - sl.Metrics.WidthIncludingTrailingWhitespace, y + (IH - sl.Metrics.Height) / 2), sl, br);
            }
        }
        Dc.Transform = Matrix3x2.Identity;
    }

    int HitIdx(float x, float y)
    {
        if (x < PAD + SIDE || x > PAD + pw - SIDE) return -1;
        for (int i = 0; i < items.Count; i++) { if (items[i].Sep || items[i].Hd) continue; if (y >= PAD + ys[i] && y < PAD + ys[i] + IH) return i; }
        return -1;
    }

    protected override IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled)
    {
        handled = true;
        switch (m)
        {
            case N.WM_NCHITTEST:
                { int x = N.Lo(l), y = N.Hi(l); return (IntPtr)(IsOpen && InPanelPx(x, y) ? N.HTCLIENT : N.HTTRANSPARENT); }
            case N.WM_MOUSEACTIVATE: return (IntPtr)N.MA_NOACTIVATE;
            case N.WM_MOUSEMOVE: { int h = HitIdx(N.Lo(l) / Scale, N.Hi(l) / Scale); if (h != hot) { hot = h; Dirty = true; } Track(); return IntPtr.Zero; }
            case N.WM_MOUSELEAVE: Untrack(); if (hot != -1) { hot = -1; Dirty = true; } return IntPtr.Zero;
            case N.WM_LBUTTONDOWN: armed = HitIdx(N.Lo(l) / Scale, N.Hi(l) / Scale); return IntPtr.Zero;
            case N.WM_LBUTTONUP:
                {
                    int h = HitIdx(N.Lo(l) / Scale, N.Hi(l) / Scale);
                    if (h >= 0 && h == armed && !items[h].Dis) { string id = items[h].Id; Close(); Emit?.Invoke("macpop:nact", id); }
                    armed = -1; return IntPtr.Zero;
                }
            case N.WM_ERASEBKGND: return (IntPtr)1;
        }
        handled = false; return IntPtr.Zero;
    }

    public override void Dispose() { glass?.Dispose(); base.Dispose(); }
}
