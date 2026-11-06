using System.Numerics;
using System.Runtime.InteropServices;
using Vortice;
using Vortice.Direct2D1;
using Vortice.DCommon;
using Vortice.DirectWrite;
using Vortice.Mathematics;

namespace MacShell;

class WinInfo { public string H, Title; public bool Min; }

class DockItem
{
    public string Key, Name; public bool Running, Active, Minimized, Pinned, Pack; public int Count; public ID2D1Bitmap1 Icon; public string IconSig;
    public List<WinInfo> Wins = new();
    public string Letter => string.IsNullOrEmpty(Name) ? "?" : Name[..1].ToUpperInvariant();
}

/// <summary>Dock: Big Sur tarzı buzlu cam + büyüyen simgeler, sürükleyerek sıralama, otomatik gizleme, pencere önizlemeleri.</summary>
class DockWindow : Surface
{
    public List<DockItem> Items = new();
    public float Size = 40; public Action<string, object> Emit;
    public bool AutoHide, PreviewOn = true;
    float peak = .40f, springK = .13f, springD = .78f, spread = 1.35f, tipK = .28f;
    public void SetAnim(string a)
    {
        switch (a) { case "soft": peak = .26f; springK = .075f; springD = .88f; spread = 1.6f; tipK = .16f; break; case "off": peak = 0f; springK = .2f; springD = .7f; spread = 1.35f; tipK = .28f; break; default: peak = .40f; springK = .13f; springD = .78f; spread = 1.35f; tipK = .28f; break; }
        Dirty = true;
    }
    ID2D1Bitmap1 wall; string wallSig; float wallIw, wallIh, bdSw, bdSh, bdOx, bdOy;
    ID2D1Bitmap1 glass; string glassSig;
    float[] cur = Array.Empty<float>(), vel = Array.Empty<float>(), baseX = Array.Empty<float>(), slotX = Array.Empty<float>(), dx = Array.Empty<float>();
    bool hov; float mouseX; int hoverIdx = -1, pressIdx = -1; float tipA;
    ID2D1SolidColorBrush br; IDWriteTextFormat tipFmt, badgeFmt, letterFmt, capFmt;
    // sürükleme
    int dragIdx = -1, dragTarget = -1; bool dragging; float dragStartX, dragStartY, dragCx, dragCy;
    // otomatik gizleme
    float shown = 1f; DateTime leaveAt = DateTime.MinValue;
    // önizleme
    int prevIdx = -1, cand = -1; DateTime candSince = DateTime.MinValue, prevLeave = DateTime.MinValue; float prevA;
    RawRectF panel; List<RawRectF> cells = new(); int cellHot = -1; readonly List<IntPtr> thumbs = new(); List<WinInfo> prevWins = new();
    Matrix3x2 Tb = Matrix3x2.Identity; bool busy; float extL, extR;

    public DockWindow(int x, int y, int w, int h) : base("MacShell Dock", x, y, w, h) { }

    float B => Size + 10; float Gap => 4; float R => MathF.Round(Size * .36f + 6);
    record struct Slot(int Idx, float X, float W);
    List<Slot> slots = new(); float dockW, dockH;
    public RawRectF DockRect => new(W / 2 - dockW / 2, H - 10 - dockH, W / 2 + dockW / 2, H - 10);
    float HideOff => dockH + 24;

    void Layout()
    {
        slots.Clear(); float x = 8; bool sepDone = false;
        bool hasP = Items.Any(i => i.Pinned), hasO = Items.Any(i => !i.Pinned);
        if (slotX.Length != Items.Count) slotX = new float[Items.Count];
        for (int i = 0; i < Items.Count; i++)
        {
            if (hasP && hasO && !Items[i].Pinned && !sepDone) { sepDone = true; slots.Add(new Slot(-1, x + 3, 1)); x += 7 + Gap; }
            slots.Add(new Slot(i, x, B)); slotX[i] = x; x += B + Gap;
        }
        dockW = Math.Max(40, x - Gap + 8); dockH = B + 9;
        if (baseX.Length != Items.Count) { cur = Enumerable.Repeat(1f, Items.Count).ToArray(); vel = new float[Items.Count]; baseX = new float[Items.Count]; dx = (float[])slotX.Clone(); }
        for (int i = 0; i < Items.Count; i++) baseX[i] = slotX[i] + B / 2 - dockW / 2;
    }

    public void SetItems(float size, List<DockItem> items)
    {
        if (dragging) { dragging = false; dragIdx = -1; N.ReleaseCapture(); }
        string prevKey = prevIdx >= 0 && prevIdx < Items.Count ? Items[prevIdx].Key : null;
        Size = size; Items = items; Layout(); dx = (float[])slotX.Clone(); glassSig = null; Dirty = true;
        if (prevKey != null) { int n = items.FindIndex(q => q.Key == prevKey); if (n < 0) ClosePreview(); else prevIdx = n; }
    }
    public void SetWall(ID2D1Bitmap1 bmp, string sig, float iw, float ih, float sw, float sh, float ox, float oy)
    {
        wall?.Dispose(); wall = bmp; wallSig = sig; wallIw = iw; wallIh = ih; bdSw = sw; bdSh = sh; bdOx = ox; bdOy = oy; glassSig = null; Dirty = true;
    }
    public void UpdateWallPos(float ox, float oy, float sw, float sh) { if (ox != bdOx || oy != bdOy || sw != bdSw || sh != bdSh) { bdOx = ox; bdOy = oy; bdSw = sw; bdSh = sh; glassSig = null; Dirty = true; } }
    protected override void OnResize() { glassSig = null; }

    void EnsureGlass()
    {
        Layout();
        string sig = $"{dockW:F0}x{dockH:F0}r{R}s{Scale}w{wallSig}H{H:F0}";
        if (sig == glassSig) return; glassSig = sig;
        glass?.Dispose(); glass = null;
        if (wall == null) return;
        float k = MathF.Max(bdSw / wallIw, bdSh / wallIh), offX = (bdSw - wallIw * k) / 2, offY = (bdSh - wallIh * k) / 2;
        var r = DockRect;
        float scrX = bdOx + r.Left, scrY = bdOy + r.Top;
        glass = Glass.Make(wall, (scrX - offX) / k, (scrY - offY) / k, dockW / k, dockH / k, dockW, dockH, R, Scale, blur: 14, refractOn: false);
    }

    // ---- hareket ----
    public override bool Animating => hov || busy || dragging || prevIdx >= 0;

    void Spring()
    {
        float unit = Size + 14, mx = mouseX - W / 2; busy = false;
        bool mag = hov && !dragging && shown > .9f;
        for (int i = 0; i < cur.Length; i++)
        {
            float target = mag ? 1 + peak * MathF.Exp(-MathF.Pow((mx - baseX[i]) / (unit * spread), 2)) : 1;
            vel[i] = (vel[i] + (target - cur[i]) * springK) * springD; cur[i] += vel[i];
            if (MathF.Abs(target - cur[i]) > .002f || MathF.Abs(vel[i]) > .002f) busy = true; else cur[i] = target;
        }
        float tgt = (mag && hoverIdx >= 0 && prevIdx < 0) ? 1 : 0; float p0 = tipA; tipA += (tgt - tipA) * tipK; if (MathF.Abs(tgt - tipA) < .01f) tipA = tgt; if (tipA != p0) busy = true;
        // slot kaydırma (sürüklerken komşular yer açar)
        for (int i = 0; i < Items.Count && i < dx.Length; i++)
        {
            float t = slotX[PosOf(i)];
            dx[i] += (t - dx[i]) * .28f; if (MathF.Abs(t - dx[i]) < .1f) dx[i] = t; else busy = true;
        }
        // otomatik gizleme
        if (AutoHide)
        {
            float t = (hov || dragging || prevIdx >= 0 || CursorAtEdge()) ? 1f : (DateTime.UtcNow < leaveAt ? 1f : 0f);
            shown += (t - shown) * .22f; if (MathF.Abs(t - shown) < .004f) shown = t; else busy = true;
        }
        else if (shown != 1f) { shown = 1f; }
        float pt = prevIdx >= 0 ? 1 : 0; float pp = prevA; prevA += (pt - prevA) * .3f; if (MathF.Abs(pt - prevA) < .01f) prevA = pt; if (pp != prevA) busy = true;
        Tb = Matrix3x2.CreateTranslation(0, (1 - shown) * HideOff);
    }
    int PosOf(int i)
    {
        if (!dragging || dragIdx < 0 || dragTarget < 0 || dragTarget == dragIdx) return i;
        if (i == dragIdx) return dragTarget;
        if (dragIdx < dragTarget && i > dragIdx && i <= dragTarget) return i - 1;
        if (dragIdx > dragTarget && i >= dragTarget && i < dragIdx) return i + 1;
        return i;
    }
    bool CursorAtEdge()
    {
        N.GetCursorPos(out var p); return p.Y >= PxY + PxH - 2 && p.X >= PxX && p.X < PxX + PxW;
    }

    // ---- çizim ----
    public override void Draw()
    {
        br ??= Dc.CreateSolidColorBrush(new Color4(1, 1, 1, 1));
        tipFmt ??= Gfx.Text(13, FontWeight.Medium); badgeFmt ??= Gfx.Text(10, FontWeight.SemiBold); letterFmt ??= Gfx.Text(20, FontWeight.SemiBold); capFmt ??= Gfx.Text(12, FontWeight.Medium);
        EnsureGlass(); Spring();
        if (dockW <= 0) return;
        Dc.Transform = Tb;
        var r0 = DockRect; float cr = R, grow = cur.Sum(c => (c - 1) * (B + Gap)); if (grow < 0) grow = 0;
        float tot = cur.Sum(c => (c - 1) * (B + Gap)), accP = 0, gl = r0.Left - grow / 2, gr = r0.Right + grow / 2;
        var cxs = new float[Items.Count];
        for (int i = 0; i < Items.Count; i++)
        {
            float e = (cur[i] - 1) * (B + Gap); cxs[i] = r0.Left + dx[i] + B / 2 + accP + e / 2 - tot / 2; accP += e;
            float hw = B * cur[i] / 2; gl = Math.Min(gl, cxs[i] - hw - 6); gr = Math.Max(gr, cxs[i] + hw + 6);
        }
        extL = gl; extR = gr;
        var r = new RawRectF(gl, r0.Top, gr, r0.Bottom);
        var rr = new RoundedRectangle(r, cr, cr);
        if (glass != null)
        {
            if (grow < .5f) Dc.DrawBitmap(glass, r, 1f, InterpolationMode.Linear, null, null);
            else
            {
                float c = cr + 2;
                Dc.DrawBitmap(glass, new RawRectF(r.Left, r.Top, r.Left + c, r.Bottom), 1f, InterpolationMode.Linear, new RawRectF(0, 0, c, dockH), null);
                Dc.DrawBitmap(glass, new RawRectF(r.Left + c, r.Top, r.Right - c, r.Bottom), 1f, InterpolationMode.Linear, new RawRectF(c, 0, dockW - c, dockH), null);
                Dc.DrawBitmap(glass, new RawRectF(r.Right - c, r.Top, r.Right, r.Bottom), 1f, InterpolationMode.Linear, new RawRectF(dockW - c, 0, dockW, dockH), null);
            }
        }
        else { br.Color = new Color4(.1f, .11f, .14f, .55f); Dc.FillRoundedRectangle(rr, br); }
        using (var gs = Dc.CreateGradientStopCollection(new[] { new GradientStop { Position = 0, Color = new Color4(1, 1, 1, .20f) }, new GradientStop { Position = 1, Color = new Color4(1, 1, 1, .10f) } }))
        using (var lg = Dc.CreateLinearGradientBrush(new LinearGradientBrushProperties { StartPoint = new Vector2(r.Left, r.Top), EndPoint = new Vector2(r.Left, r.Bottom) }, gs))
        { br.Color = new Color4(.35f, .35f, .4f, .10f); Dc.FillRoundedRectangle(rr, br); Dc.FillRoundedRectangle(rr, lg); }
        br.Color = new Color4(1, 1, 1, .32f);
        Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(r.Left + .5f, r.Top + .5f, r.Right - .5f, r.Bottom - .5f), cr - .5f, cr - .5f), br, 1f);

        foreach (var s in slots) if (s.Idx < 0) { float sx = r0.Left + s.X + SepShift(s); br.Color = new Color4(1, 1, 1, .3f); Dc.FillRectangle(new RawRectF(sx, r.Top + 10, sx + 1, r.Bottom - 12), br); }

        for (int i = 0; i < Items.Count; i++)
        {
            if (dragging && i == dragIdx) continue;
            float cx = cxs[i];
            DrawItem(i, cx, r.Top + 2, cur[i], i == pressIdx && !dragging ? .84f : 1f);
        }
        if (dragging && dragIdx >= 0 && dragIdx < Items.Count) DrawItem(dragIdx, dragCx, r.Top + 2 - 6, 1.1f, 1f, true);

        // ipucu
        if (tipA > .02f && hoverIdx >= 0 && hoverIdx < Items.Count && !dragging)
        {
            using var lay = Gfx.DW.CreateTextLayout(Items[hoverIdx].Name ?? "", tipFmt, 600, 30);
            float tw = lay.Metrics.Width + 24, th = 26;
            float tx = Math.Clamp(r0.Left + dx[hoverIdx] + B / 2 - tw / 2 + HoverShift(hoverIdx), 4, W - tw - 4);
            float ty = Math.Max(2, r.Top - 8 - th - 14 * tipA + (1 - tipA) * 4);
            Dc.Transform = Matrix3x2.CreateScale(.92f + .08f * tipA, .92f + .08f * tipA, new Vector2(tx + tw / 2, ty + th)) * Tb;
            br.Color = new Color4(.157f, .157f, .18f, .9f * tipA); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(tx, ty, tx + tw, ty + th), 10, 10), br);
            br.Color = new Color4(1, 1, 1, .25f * tipA); Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(tx + .5f, ty + .5f, tx + tw - .5f, ty + th - .5f), 10, 10), br, 1f);
            br.Color = new Color4(1, 1, 1, tipA); Dc.DrawTextLayout(new Vector2(tx + 12, ty + (th - lay.Metrics.Height) / 2), lay, br);
            Dc.Transform = Tb;
        }
        if (dragging && dragCy < r.Top - 70 && dragIdx >= 0 && Items[dragIdx].Pinned)
        { // dışarı sürüklenen sabit uygulama: kaldırma ipucu
            using var lay = Gfx.DW.CreateTextLayout("Kaldır", tipFmt, 200, 30); float tw = lay.Metrics.Width + 24;
            br.Color = new Color4(.157f, .157f, .18f, .92f); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(dragCx - tw / 2, dragCy - 54, dragCx + tw / 2, dragCy - 28), 10, 10), br);
            br.Color = new Color4(1, 1, 1, 1); Dc.DrawTextLayout(new Vector2(dragCx - tw / 2 + 12, dragCy - 54 + (26 - lay.Metrics.Height) / 2), lay, br);
        }
        Dc.Transform = Matrix3x2.Identity;
        DrawPreview(r);
    }

    void DrawItem(int i, float cx, float boxTop, float scale, float press, bool lifted = false)
    {
        var it = Items[i]; float boxBot = boxTop + B;
        Dc.Transform = Matrix3x2.CreateScale(scale * press, scale * press, new Vector2(cx, press < 1 ? boxTop + B / 2 + 4 : boxBot)) * Tb;
        var rect = new RawRectF(cx - Size / 2, boxTop + 5, cx + Size / 2, boxTop + 5 + Size);
        var bmp = it.Icon; float op = (it.Minimized ? .55f : 1f) * (lifted ? .92f : 1f);
        if (bmp != null && !it.Pack)
        {
            float pr = Size * .225f;
            using (var gs = Dc.CreateGradientStopCollection(new[] { new GradientStop { Position = 0, Color = new Color4(.98f, .98f, 1f, op) }, new GradientStop { Position = 1, Color = new Color4(.78f, .79f, .85f, op) } }))
            using (var lg = Dc.CreateLinearGradientBrush(new LinearGradientBrushProperties { StartPoint = new Vector2(rect.Left, rect.Top), EndPoint = new Vector2(rect.Left, rect.Bottom) }, gs))
                Dc.FillRoundedRectangle(new RoundedRectangle(rect, pr, pr), lg);
            br.Color = new Color4(0, 0, 0, .12f * op); Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(rect.Left + .5f, rect.Top + .5f, rect.Right - .5f, rect.Bottom - .5f), pr, pr), br, 1f);
            float inset = Size * .17f;
            Dc.DrawBitmap(bmp, new RawRectF(rect.Left + inset, rect.Top + inset, rect.Right - inset, rect.Bottom - inset), op, InterpolationMode.HighQualityCubic, null, null);
        }
        else if (bmp != null) Dc.DrawBitmap(bmp, rect, op, InterpolationMode.HighQualityCubic, null, null);
        else
        {
            var hue = (it.Name?.Aggregate(0, (h, c) => (h * 31 + c) % 360) ?? 0) / 360f;
            br.Color = HslColor(hue, .45f, .42f); Dc.FillRoundedRectangle(new RoundedRectangle(rect, Size * .24f, Size * .24f), br);
            using var lay = Gfx.DW.CreateTextLayout(it.Letter, letterFmt, Size, Size); lay.TextAlignment = TextAlignment.Center; lay.ParagraphAlignment = ParagraphAlignment.Center;
            br.Color = new Color4(1, 1, 1, 1); Dc.DrawTextLayout(new Vector2(rect.Left, rect.Top), lay, br);
        }
        if (it.Count > 1)
        {
            float bw = Math.Max(15, 8 + 6 * it.Count.ToString().Length);
            var bx = new RawRectF(rect.Right - bw + 5, rect.Top - 5, rect.Right + 5, rect.Top + 10);
            br.Color = new Color4(.039f, .518f, 1f, 1); Dc.FillRoundedRectangle(new RoundedRectangle(bx, 7.5f, 7.5f), br);
            using var lay = Gfx.DW.CreateTextLayout(it.Count.ToString(), badgeFmt, bw, 15); lay.TextAlignment = TextAlignment.Center; lay.ParagraphAlignment = ParagraphAlignment.Center;
            br.Color = new Color4(1, 1, 1, 1); Dc.DrawTextLayout(new Vector2(bx.Left, bx.Top), lay, br);
        }
        Dc.Transform = Tb;
        if (it.Running && !lifted)
        {
            float dyy = boxBot + 1;
            if (it.Active) { br.Color = new Color4(1, 1, 1, .25f); Dc.FillEllipse(new Ellipse(new Vector2(cx, dyy), 3.2f, 3.2f), br); }
            br.Color = new Color4(1, 1, 1, it.Active ? 1f : .7f); Dc.FillEllipse(new Ellipse(new Vector2(cx, dyy), 1.3f, 1.3f), br);
        }
    }

    // ---- pencere önizlemesi ----
    const float CW = 168, CH = 104, CT = 20;
    void OpenPreview(int idx)
    {
        if (idx == prevIdx) return; ClosePreview(false);
        var it = Items[idx]; prevWins = it.Wins.Take(5).ToList(); if (prevWins.Count == 0) return; prevIdx = idx;
        N.DwmRegisterAll(Hwnd, prevWins, thumbs); Dirty = true; PlacePanel();
    }
    void ClosePreview(bool redraw = true)
    {
        foreach (var t in thumbs) N.DwmUnregisterThumbnail(t); thumbs.Clear(); cells.Clear(); prevIdx = -1; cellHot = -1; prevWins = new(); if (redraw) Dirty = true;
    }
    void PlacePanel()
    {
        if (prevIdx < 0 || prevIdx >= Items.Count) return;
        int n = prevWins.Count; float pw = n * CW + (n - 1) * 8 + 20, ph = 10 + CH + 6 + CT + 6;
        var r0 = DockRect; float cx = r0.Left + dx[prevIdx] + B / 2 + HoverShift(prevIdx);
        float left = Math.Clamp(cx - pw / 2, 6, W - pw - 6), top = Math.Max(2, r0.Top - 14 - Size * .4f - ph);
        panel = new RawRectF(left, top, left + pw, top + ph); cells.Clear();
        for (int i = 0; i < n; i++) cells.Add(new RawRectF(left + 10 + i * (CW + 8), top + 10, left + 10 + i * (CW + 8) + CW, top + 10 + CH));
    }
    void DrawPreview(RawRectF dock)
    {
        if (prevIdx < 0 || prevA < .02f) return;
        PlacePanel(); var tb = Tb;
        Dc.Transform = Tb;
        var rr = new RoundedRectangle(panel, 14, 14);
        br.Color = new Color4(.12f, .12f, .15f, .78f * prevA); Dc.FillRoundedRectangle(rr, br);
        br.Color = new Color4(1, 1, 1, .26f * prevA); Dc.DrawRoundedRectangle(new RoundedRectangle(new RawRectF(panel.Left + .5f, panel.Top + .5f, panel.Right - .5f, panel.Bottom - .5f), 13.5f, 13.5f), br, 1f);
        for (int i = 0; i < prevWins.Count; i++)
        {
            var c = cells[i];
            if (i == cellHot) { br.Color = new Color4(1, 1, 1, .16f); Dc.FillRoundedRectangle(new RoundedRectangle(new RawRectF(c.Left - 5, c.Top - 5, c.Right + 5, c.Bottom + CT + 6), 10, 10), br); }
            br.Color = new Color4(0, 0, 0, .35f); Dc.FillRoundedRectangle(new RoundedRectangle(c, 6, 6), br);
            string t = prevWins[i].Title ?? ""; using var lay = Gfx.DW.CreateTextLayout(t, capFmt, CW, CT); lay.WordWrapping = WordWrapping.NoWrap; lay.TextAlignment = TextAlignment.Center;
            using (var tr = Gfx.DW.CreateEllipsisTrimmingSign(lay)) lay.SetTrimming(new Trimming { Granularity = TrimmingGranularity.Character }, tr);
            br.Color = new Color4(1, 1, 1, .95f); Dc.DrawTextLayout(new Vector2(c.Left, c.Bottom + 4), lay, br);
            if (prevWins[i].Min) { using var l2 = Gfx.DW.CreateTextLayout("Küçültülmüş", capFmt, CW, 20); l2.TextAlignment = TextAlignment.Center; br.Color = new Color4(1, 1, 1, .5f); Dc.DrawTextLayout(new Vector2(c.Left, c.Top + CH / 2 - 8), l2, br); }
            else N.DwmPlace(thumbs, i, cells[i], Scale, (1 - shown) * HideOff, prevA);
        }
        Dc.Transform = Matrix3x2.Identity;
    }

    float SepShift(Slot sl) { float acc = 0; foreach (var q in slots) { if (q.Idx >= 0 && q.X < sl.X) acc += (cur[q.Idx] - 1) * (B + Gap); } float tot = cur.Sum(c => (c - 1) * (B + Gap)); return acc - tot / 2; }
    float HoverShift(int i) { if (i < 0 || i >= cur.Length) return 0; float acc = 0, tot = cur.Sum(c => (c - 1) * (B + Gap)); for (int j = 0; j < i; j++) acc += (cur[j] - 1) * (B + Gap); return acc + (cur[i] - 1) * (B + Gap) / 2 - tot / 2; }

    static Color4 HslColor(float h, float s, float l)
    {
        float c = (1 - MathF.Abs(2 * l - 1)) * s, x = c * (1 - MathF.Abs(h * 6 % 2 - 1)), m = l - c / 2, r, g, b;
        int k = (int)(h * 6) % 6; (r, g, b) = k switch { 0 => (c, x, 0f), 1 => (x, c, 0f), 2 => (0f, c, x), 3 => (0f, x, c), 4 => (x, 0f, c), _ => (c, 0f, x) };
        return new Color4(r + m, g + m, b + m, 1);
    }

    // ---- girdi ----
    public RawRectF HitRect()
    {
        var r = DockRect; var h = hov || prevIdx >= 0 ? new RawRectF(r.Left - 60, r.Top - 44, r.Right + 60, r.Bottom) : r;
        float o = (1 - shown) * HideOff; return new RawRectF(h.Left, h.Top + o, h.Right, h.Bottom + o);
    }
    protected override void AfterFrame()
    {
        if (dockW <= 0) return;
        var h = HitRect(); float l = h.Left, t = h.Top, r = h.Right, b = h.Bottom + 12, o = (1 - shown) * HideOff;
        l = Math.Min(l, extL - 6); r = Math.Max(r, extR + 6); // küçülürken cam kırpılmasın
        if (cur.Any(c => c > 1.003f) || tipA > .01f) t = Math.Min(t, DockRect.Top - 56 + o);
        if (dragging) { l = 0; t = 0; r = W; b = H; }
        else if (prevIdx >= 0) { l = Math.Min(l, panel.Left - 4); r = Math.Max(r, panel.Right + 4); t = Math.Min(t, panel.Top + o - 6); }
        SetHitRegion(l, t, r, b);
    }
    bool InPanelArea(float x, float y)
    {
        if (prevIdx < 0) return false; var r = DockRect;
        return x >= Math.Min(panel.Left, r.Left) - 4 && x <= Math.Max(panel.Right, r.Right) + 4 && y >= panel.Top - 4 && y <= r.Bottom + 12;
    }
    int HitItem(float x, float y)
    {
        var r = DockRect; y -= (1 - shown) * HideOff; float tot = cur.Sum(c => (c - 1) * (B + Gap));
        for (int i = 0; i < Items.Count; i++)
        {
            float cx = r.Left + dx[i] + B / 2, acc = 0, shift = 0;
            for (int j = 0; j <= i; j++) { float e = (cur[j] - 1) * (B + Gap); if (j == i) shift = acc + e / 2 - tot / 2; acc += e; }
            float half = B / 2 * cur[i];
            if (x >= cx + shift - half && x <= cx + shift + half && y >= r.Top - 44 && y <= r.Bottom) return i;
        }
        return -1;
    }
    int HitCell(float x, float y) { for (int i = 0; i < cells.Count; i++) { var c = cells[i]; if (x >= c.Left - 5 && x <= c.Right + 5 && y >= c.Top - 5 && y <= c.Bottom + CT + 6) return i; } return -1; }

    public bool Force; public void ForceHover(float x, int idx) { Force = true; hov = true; mouseX = x; hoverIdx = idx; if (idx >= 0 && idx < Items.Count && Items[idx].Wins.Count > 0) OpenPreview(idx); Dirty = true; }
    public void Poll()
    {
        var c = CursorDip(); var now = DateTime.UtcNow;
        if (AutoHide)
        {
            bool want = hov || dragging || prevIdx >= 0 || CursorAtEdge(); if (want) leaveAt = now.AddMilliseconds(450);
            if ((want || now < leaveAt ? 1f : 0f) != shown) Dirty = true;
        }
        if (!hov && !Force && !dragging && prevIdx >= 0)
        { // imleç pencereden çıktı: önizleme kapanmalı
            if (prevLeave == DateTime.MinValue) prevLeave = now;
            PreviewLogic(c, now, (1 - shown) * HideOff); return;
        }
        if (!hov || Force || dragging) return;
        var hr = HitRect(); float oy = (1 - shown) * HideOff;
        bool inArea = c.X >= hr.Left && c.X <= hr.Right && c.Y >= hr.Top && c.Y <= hr.Bottom + 12 || InPanelArea(c.X, c.Y - oy);
        if (!inArea) { hov = false; hoverIdx = -1; pressIdx = -1; cellHot = -1; if (prevIdx >= 0 && prevLeave == DateTime.MinValue) prevLeave = now; Dirty = true; }
        else { mouseX = c.X; if (prevIdx < 0 || c.Y - oy > panel.Bottom) { int h = HitItem(c.X, c.Y); if (h != hoverIdx) hoverIdx = h; } Dirty = true; }
        PreviewLogic(c, now, oy);
    }
    void PreviewLogic(Vector2 c, DateTime now, float oy)
    {
        if (!PreviewOn) { if (prevIdx >= 0) ClosePreview(); return; }
        if (prevIdx >= 0)
        {
            bool inside = InPanelArea(c.X, c.Y - oy) || (hov && hoverIdx == prevIdx);
            if (inside) prevLeave = DateTime.MinValue; else if (prevLeave == DateTime.MinValue) prevLeave = now;
            if (prevLeave != DateTime.MinValue && (now - prevLeave).TotalMilliseconds > 220) { ClosePreview(); return; }
            cellHot = HitCell(c.X, c.Y - oy);
            if (hov && hoverIdx >= 0 && hoverIdx != prevIdx && Items[hoverIdx].Running && Items[hoverIdx].Wins.Count > 0 && c.Y - oy > DockRect.Top - 50)
            { if (cand != hoverIdx) { cand = hoverIdx; candSince = now; } else if ((now - candSince).TotalMilliseconds > 160) OpenPreview(hoverIdx); }
            return;
        }
        if (hov && hoverIdx >= 0 && Items[hoverIdx].Running && Items[hoverIdx].Wins.Count > 0 && !dragging)
        { if (cand != hoverIdx) { cand = hoverIdx; candSince = now; } else if ((now - candSince).TotalMilliseconds > 480) OpenPreview(hoverIdx); }
        else cand = -1;
    }

    void StartDragCheck(float x, float y)
    {
        if (dragIdx < 0 || dragging) return;
        if (MathF.Abs(x - dragStartX) > 6 || MathF.Abs(y - dragStartY) > 8) { dragging = true; dragTarget = dragIdx; ClosePreview(); tipA = 0; }
    }
    void UpdateDrag(float x, float y)
    {
        dragCx = x; dragCy = y; var r = DockRect; bool pin = Items[dragIdx].Pinned;
        int g0 = 0, g1 = Items.Count - 1; // yalnızca kendi grubunda (sabit / çalışan) yer değiştirir
        for (int i = 0; i < Items.Count; i++) if (Items[i].Pinned == pin) { g0 = i; break; }
        for (int i = Items.Count - 1; i >= 0; i--) if (Items[i].Pinned == pin) { g1 = i; break; }
        int best = dragIdx; float bd = float.MaxValue;
        for (int p = g0; p <= g1; p++) { float d = MathF.Abs(x - (r.Left + slotX[p] + B / 2)); if (d < bd) { bd = d; best = p; } }
        dragTarget = best; Dirty = true;
    }

    protected override IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled)
    {
        handled = true;
        switch (m)
        {
            case N.WM_NCHITTEST:
                {
                    float x = (N.Lo(l) - PxX) / Scale, y = (N.Hi(l) - PxY) / Scale; var hr = HitRect(); float oy = (1 - shown) * HideOff;
                    bool inPanel = prevIdx >= 0 && InPanelArea(x, y - oy);
                    if (shown > .5f && (x >= hr.Left && x <= hr.Right && y >= hr.Top && y <= hr.Bottom || inPanel)) { if (!hov) { hov = true; mouseX = x; Track(); Dirty = true; } return (IntPtr)N.HTCLIENT; }
                    return (IntPtr)N.HTTRANSPARENT;
                }
            case N.WM_MOUSEACTIVATE: return (IntPtr)N.MA_NOACTIVATE;
            case N.WM_MOUSEMOVE:
                {
                    float x = N.Lo(l) / Scale, y = N.Hi(l) / Scale; hov = true; mouseX = x; Track();
                    if (dragIdx >= 0) { StartDragCheck(x, y); if (dragging) UpdateDrag(x, y); }
                    else if (prevIdx < 0 || y - (1 - shown) * HideOff > panel.Bottom) hoverIdx = HitItem(x, y);
                    Dirty = true; return IntPtr.Zero;
                }
            case N.WM_MOUSELEAVE: Untrack(); if (!dragging) { hov = false; hoverIdx = -1; pressIdx = -1; } Dirty = true; return IntPtr.Zero;
            case N.WM_LBUTTONDOWN:
                {
                    float x = N.Lo(l) / Scale, y = N.Hi(l) / Scale; float oy = (1 - shown) * HideOff;
                    if (prevIdx >= 0) { int ch = HitCell(x, y - oy); if (ch >= 0) { Emit?.Invoke("macdock:win", prevWins[ch].H); ClosePreview(); return IntPtr.Zero; } }
                    int i = HitItem(x, y);
                    if (i >= 0) { pressIdx = i; dragIdx = i; dragStartX = x; dragStartY = y; N.SetCapture(Hwnd); }
                    Dirty = true; return IntPtr.Zero;
                }
            case N.WM_LBUTTONUP:
                {
                    float x = N.Lo(l) / Scale, y = N.Hi(l) / Scale; N.ReleaseCapture();
                    if (dragging && dragIdx >= 0)
                    {
                        var r = DockRect; bool pin = Items[dragIdx].Pinned;
                        if (y < r.Top - 70 && pin) Emit?.Invoke("macdock:unpin", Items[dragIdx].Key);
                        else if (dragTarget >= 0 && dragTarget != dragIdx)
                        {
                            var keys = Items.Select(q => q.Key).ToList(); var k = keys[dragIdx]; keys.RemoveAt(dragIdx); keys.Insert(dragTarget, k);
                            Emit?.Invoke("macdock:reorder", keys.ToArray());
                        }
                    }
                    else if (dragIdx >= 0 && pressIdx == dragIdx) Emit?.Invoke("macdock:click", Items[dragIdx].Key);
                    dragging = false; dragIdx = -1; dragTarget = -1; pressIdx = -1; Dirty = true; return IntPtr.Zero;
                }
            case N.WM_RBUTTONUP:
                { int i = HitItem(N.Lo(l) / Scale, N.Hi(l) / Scale); if (i >= 0) Emit?.Invoke("macdock:menu", Items[i].Key); return IntPtr.Zero; }
            case N.WM_ERASEBKGND: return (IntPtr)1;
        }
        handled = false; return IntPtr.Zero;
    }

    public override void Dispose() { ClosePreview(false); base.Dispose(); }
}
