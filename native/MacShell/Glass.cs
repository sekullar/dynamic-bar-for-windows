using System.Numerics;
using Vortice.Direct2D1;
using Vortice.Direct2D1.Effects;
using Vortice.DCommon;
using Vortice.DXGI;
using Vortice.Mathematics;
using Vortice;
using Vortice.WIC;
using AlphaMode = Vortice.DCommon.AlphaMode;

namespace MacShell;

/// <summary>Görüntü yükleme ve "sıvı cam" (bulanıklık + kırılma + doygunluk) üretimi — hepsi GPU'da.</summary>
static class Glass
{
    static IWICImagingFactory wic;
    static ID2D1DeviceContext util;
    public static ID2D1DeviceContext Util => util ??= Gfx.D2DDev.CreateDeviceContext(DeviceContextOptions.None);

    public static ID2D1Bitmap1 Load(byte[] data)
    {
        try
        {
            wic ??= new IWICImagingFactory();
            using var ms = new MemoryStream(data);
            using var dec = wic.CreateDecoderFromStream(ms, DecodeOptions.CacheOnDemand);
            using var fr = dec.GetFrame(0);
            using var conv = wic.CreateFormatConverter();
            conv.Initialize(fr, Vortice.WIC.PixelFormat.Format32bppPBGRA, BitmapDitherType.None, null, 0, BitmapPaletteType.MedianCut);
            return Util.CreateBitmapFromWicBitmap(conv, new BitmapProperties1(new Vortice.DCommon.PixelFormat(Format.B8G8R8A8_UNorm, AlphaMode.Premultiplied), 96, 96, BitmapOptions.None));
        }
        catch { return null; }
    }
    public static ID2D1Bitmap1 LoadDataUrl(string url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        int i = url.IndexOf("base64,", StringComparison.Ordinal); if (i < 0) return null;
        try { return Load(Convert.FromBase64String(url[(i + 7)..])); } catch { return null; }
    }

    // Kırılma haritası: kenara yaklaştıkça içe doğru yer değiştirme (R,G; 128 = sıfır)
    static ID2D1Bitmap1 MakeMap(int wPx, int hPx, float scale, float M, float w, float h, float r, float bezel)
    {
        var data = new byte[wPx * hPx * 4];
        float hx = w / 2, hy = h / 2; r = Math.Min(r, Math.Min(hx, hy));
        for (int y = 0; y < hPx; y++)
            for (int x = 0; x < wPx; x++)
            {
                float px = (x + .5f) / scale - M - hx, py = (y + .5f) / scale - M - hy;
                float qx = MathF.Abs(px) - (hx - r), qy = MathF.Abs(py) - (hy - r);
                float outd = MathF.Sqrt(MathF.Pow(MathF.Max(qx, 0), 2) + MathF.Pow(MathF.Max(qy, 0), 2));
                float dist = -(outd + MathF.Min(MathF.Max(qx, qy), 0) - r);
                float R = 128, G = 128;
                if (dist >= 0 && dist < bezel)
                {
                    float t = 1 - dist / bezel, mag = t * t * t, nx, ny;
                    if (qx > 0 && qy > 0) { float l = MathF.Sqrt(qx * qx + qy * qy); if (l == 0) l = 1; nx = MathF.Sign(px) * qx / l; ny = MathF.Sign(py) * qy / l; }
                    else if (qx > qy) { nx = MathF.Sign(px); ny = 0; } else { nx = 0; ny = MathF.Sign(py); }
                    R = 128 + nx * mag * 127; G = 128 + ny * mag * 127;
                }
                int i = (y * wPx + x) * 4; data[i] = 128; data[i + 1] = (byte)G; data[i + 2] = (byte)R; data[i + 3] = 255;
            }
        unsafe
        {
            fixed (byte* p = data)
                return Util.CreateBitmap(new SizeI(wPx, hPx), (IntPtr)p, (uint)(wPx * 4), new BitmapProperties1(new Vortice.DCommon.PixelFormat(Format.B8G8R8A8_UNorm, AlphaMode.Ignore), 96 * scale, 96 * scale, BitmapOptions.None));
        }
    }

    /// <summary>Duvar kağıdının (srcX..) bölgesini alıp cam malzemesini uygular; w×h DIP boyutunda bitmap döner.</summary>
    public static ID2D1Bitmap1 Make(ID2D1Bitmap1 wall, float sx, float sy, float sw, float sh, float w, float h, float radius, float scale, float blur = 8, float bezel = 15, float refract = 24, bool refractOn = true)
    {
        const float M = 40;
        var dc = Util; float dpi = 96 * scale; dc.SetDpi(dpi, dpi);
        int pw = (int)MathF.Ceiling((w + 2 * M) * scale), ph = (int)MathF.Ceiling((h + 2 * M) * scale);
        var props = new BitmapProperties1(new Vortice.DCommon.PixelFormat(Format.B8G8R8A8_UNorm, AlphaMode.Premultiplied), dpi, dpi, BitmapOptions.Target);
        using var tmp = dc.CreateBitmap(new SizeI(pw, ph), IntPtr.Zero, 0, props);
        dc.Target = tmp; dc.BeginDraw(); dc.Clear(new Color4(0, 0, 0, 0));
        float k = (w + 2 * M) / sw;
        dc.DrawBitmap(wall, new RawRectF(0, 0, w + 2 * M, h + 2 * M), 1f, InterpolationMode.Linear, new RawRectF(sx - M / k, sy - M / k, sx + sw + M / k, sy + sh + M / k), null);
        dc.EndDraw();

        using var gb = new GaussianBlur(dc) { StandardDeviation = blur, BorderMode = BorderMode.Hard }; gb.SetInput(0, tmp, true);
        // doygunluk 1.9 + parlaklık 1.06
        float s = refractOn ? 1.9f : 1.45f, b = 1.06f, lr = .2126f, lg = .7152f, lb = .0722f;
        var mat = new Matrix5x4(
            (lr * (1 - s) + s) * b, lr * (1 - s) * b, lr * (1 - s) * b, 0,
            lg * (1 - s) * b, (lg * (1 - s) + s) * b, lg * (1 - s) * b, 0,
            lb * (1 - s) * b, lb * (1 - s) * b, (lb * (1 - s) + s) * b, 0,
            0, 0, 0, 1,
            0, 0, 0, 0);
        using var cm = new Vortice.Direct2D1.Effects.ColorMatrix(dc) { Matrix = mat }; cm.SetInputEffect(0, gb);
        ID2D1Image result = cm.Output; ID2D1Bitmap1 map = null; DisplacementMap dm = null;
        if (refractOn)
        {
            map = MakeMap(pw, ph, scale, M, w, h, radius, bezel);
            dm = new DisplacementMap(dc) { Scale = refract, XChannelSelect = ChannelSelector.R, YChannelSelect = ChannelSelector.G };
            dm.SetInputEffect(0, cm); dm.SetInput(1, map, true); result = dm.Output;
        }
        var outp = dc.CreateBitmap(new SizeI((int)MathF.Ceiling(w * scale), (int)MathF.Ceiling(h * scale)), IntPtr.Zero, 0, props);
        dc.Target = outp; dc.BeginDraw(); dc.Clear(new Color4(0, 0, 0, 0));
        using (var geo = Gfx.D2D.CreateRoundedRectangleGeometry(new RoundedRectangle(new RawRectF(0, 0, w, h), radius, radius)))
        {
            var lp = new LayerParameters1 { ContentBounds = new RawRectF(0, 0, w, h), GeometricMask = geo, MaskAntialiasMode = AntialiasMode.PerPrimitive, MaskTransform = Matrix3x2.Identity, Opacity = 1f };
            dc.PushLayer(lp, null);
            dc.DrawImage(result, new Vector2(-M, -M));
            dc.PopLayer();
        }
        dc.EndDraw(); dc.Target = null;
        dm?.Dispose(); map?.Dispose();
        return outp;
    }
}
