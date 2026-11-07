using System.Numerics;
using System.Runtime.InteropServices;
using Vortice.Direct2D1;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DirectComposition;
using Vortice.DirectWrite;
using Vortice.DCommon;
using Vortice.DXGI;
using Vortice.Mathematics;
using AlphaMode = Vortice.DCommon.AlphaMode;

namespace MacShell;

/// <summary>Ortak GPU aygıtları (D3D11 + Direct2D + DirectComposition + DirectWrite).</summary>
static class Gfx
{
    public static ID3D11Device D3D;
    public static IDXGIDevice Dxgi;
    public static IDXGIFactory2 Factory;
    public static ID2D1Factory1 D2D;
    public static ID2D1Device D2DDev;
    public static IDCompositionDevice Comp;
    public static IDWriteFactory DW;
    public static IDWriteFontCollection Fonts;
    public static IDWriteFactory5 DW5;

    public static void Init(string fontDir)
    {
        D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport, new[] { Vortice.Direct3D.FeatureLevel.Level_11_1, Vortice.Direct3D.FeatureLevel.Level_11_0 }, out D3D, out Vortice.Direct3D.FeatureLevel _fl, out ID3D11DeviceContext _cx);
        Dxgi = D3D.QueryInterface<IDXGIDevice>();
        using var ad = Dxgi.GetAdapter();
        Factory = ad.GetParent<IDXGIFactory2>();
        D2D = D2D1.D2D1CreateFactory<ID2D1Factory1>();
        D2DDev = D2D.CreateDevice(Dxgi);
        Comp = Vortice.DirectComposition.DComp.DCompositionCreateDevice<IDCompositionDevice>(Dxgi);
        DW = DWrite.DWriteCreateFactory<IDWriteFactory>();
        try
        {
            DW5 = DW.QueryInterface<IDWriteFactory5>();
            using var b = DW5.CreateFontSetBuilder();
            foreach (var f in Directory.GetFiles(fontDir, "*.ttf")) { using var ff = DW5.CreateFontFileReference(f); b.AddFontFile(ff); }
            using var set = b.CreateFontSet();
            Fonts = DW5.CreateFontCollectionFromFontSet(set);
        }
        catch { Fonts = null; }
    }

    public static IDWriteTextFormat Text(float size, FontWeight w = FontWeight.Medium)
    {
        var fam = Fonts != null && Fonts.FindFamilyName("Inter", out _) ? "Inter" : "Segoe UI Variable Text";
        var f = DW.CreateTextFormat(fam, Fonts != null && fam == "Inter" ? Fonts : null, w, FontStyle.Normal, FontStretch.Normal, size, "tr-TR");
        f.WordWrapping = WordWrapping.NoWrap;
        return f;
    }
}

/// <summary>Şeffaf, GPU ile çizilen üst düzey pencere (DirectComposition + Direct2D).</summary>
abstract class Surface : IDisposable
{
    static readonly N.WndProc Proc = StaticProc;
    static readonly Dictionary<IntPtr, Surface> Map = new();
    static bool registered;
    public IntPtr Hwnd;
    public int PxW, PxH, PxX, PxY; public float Scale = 1f;
    public bool Dirty = true, Visible = true; public static Action<string> OnError;
    protected IDXGISwapChain1 Swap; protected IDCompositionTarget Target; protected IDCompositionVisual Vis; protected ID2D1DeviceContext Dc;
    ID2D1Bitmap1 backBmp; bool tracking;

    static IntPtr StaticProc(IntPtr h, uint m, IntPtr w, IntPtr l)
    {
        if (Map.TryGetValue(h, out var s)) { try { var r = s.Msg(m, w, l, out var handled); if (handled) return r; } catch { } }
        return N.DefWindowProc(h, m, w, l);
    }

    protected Surface(string cls, int x, int y, int w, int h)
    {
        if (!registered)
        {
            var wc = new N.WNDCLASSEX { cbSize = (uint)Marshal.SizeOf<N.WNDCLASSEX>(), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(Proc), hInstance = N.GetModuleHandle(null), hCursor = N.LoadCursor(IntPtr.Zero, 32512), lpszClassName = "MacShellSurface" };
            N.RegisterClassEx(ref wc); registered = true;
        }
        PxX = x; PxY = y; PxW = Math.Max(1, w); PxH = Math.Max(1, h);
        Hwnd = N.CreateWindowEx(N.WS_EX_TOPMOST | N.WS_EX_TOOLWINDOW | N.WS_EX_NOACTIVATE | N.WS_EX_NOREDIRECTIONBITMAP, "MacShellSurface", cls, N.WS_POPUP, x, y, PxW, PxH, IntPtr.Zero, IntPtr.Zero, N.GetModuleHandle(null), IntPtr.Zero);
        Map[Hwnd] = this;
        Dc = Gfx.D2DDev.CreateDeviceContext(DeviceContextOptions.None);
        MakeSwap();
        Gfx.Comp.CreateTargetForHwnd(Hwnd, true, out Target); Vis = Gfx.Comp.CreateVisual(); Vis.SetContent(Swap); Target.SetRoot(Vis); Gfx.Comp.Commit();
        N.ShowWindow(Hwnd, 4); // SW_SHOWNOACTIVATE
    }

    void MakeSwap()
    {
        Swap = Gfx.Factory.CreateSwapChainForComposition(Gfx.D3D, new SwapChainDescription1
        {
            Width = (uint)PxW, Height = (uint)PxH, Format = Format.B8G8R8A8_UNorm, SampleDescription = new SampleDescription(1, 0), BufferUsage = Usage.RenderTargetOutput,
            BufferCount = 2, SwapEffect = SwapEffect.FlipSequential, AlphaMode = Vortice.DXGI.AlphaMode.Premultiplied, Scaling = Scaling.Stretch
        });
    }

    public void SetBounds(int x, int y, int w, int h, float scale)
    {
        w = Math.Max(1, w); h = Math.Max(1, h);
        bool size = w != PxW || h != PxH; Scale = scale;
        if (size)
        {
            Dc.Target = null; backBmp?.Dispose(); backBmp = null;
            PxW = w; PxH = h; Swap.ResizeBuffers(0, (uint)w, (uint)h, Format.Unknown, SwapChainFlags.None);
        }
        PxX = x; PxY = y;
        N.SetWindowPos(Hwnd, N.HWND_TOPMOST, x, y, w, h, N.SWP_NOACTIVATE | (Visible ? N.SWP_SHOWWINDOW : 0)); // gizliyken (tam ekran) yeniden gösterme
        Dirty = true; OnResize();
    }
    public void SetVisible(bool v) { Visible = v; N.ShowWindow(Hwnd, v ? 4 : 0); Dirty = true; }
    public void Raise() => N.SetWindowPos(Hwnd, N.HWND_TOPMOST, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE);
    protected virtual void OnResize() { }

    public float W => PxW / Scale; public float H => PxH / Scale; // DIP

    /// <summary>Bir kare çizer; Draw içinde Dc DIP birimiyle kullanılır.</summary>
    public void Frame()
    {
        if (!Visible) { Dirty = false; return; }
        if (backBmp == null)
        {
            using var surf = Swap.GetBuffer<IDXGISurface>(0);
            float dpi = 96f * Scale;
            backBmp = Dc.CreateBitmapFromDxgiSurface(surf, new BitmapProperties1(new PixelFormat(Format.B8G8R8A8_UNorm, AlphaMode.Premultiplied), dpi, dpi, BitmapOptions.Target | BitmapOptions.CannotDraw));
        }
        Dc.Target = backBmp; Dc.SetDpi(96f * Scale, 96f * Scale);
        Dc.BeginDraw(); Dc.Clear(new Color4(0, 0, 0, 0));
        try { Draw(); } catch (Exception e) { OnError?.Invoke(e.GetType().Name + ": " + e.Message + " @ " + e.StackTrace?.Split((char)10).FirstOrDefault()); }
        Dc.EndDraw();
        Swap.Present(1, PresentFlags.None);
        Dirty = false; AfterFrame();
    }

    protected virtual void AfterFrame() { }
    int rl = -1, rt, rr2, rb;
    /// <summary>Pencerenin tıklanabilir bölgesini kırpar: bölge dışı (şeffaf alan) tıklamayı hiç yakalamaz, alttaki pencereye geçer.</summary>
    protected void SetHitRegion(float l, float t, float r, float b)
    {
        int L = Math.Clamp((int)MathF.Floor(l * Scale), 0, PxW), T = Math.Clamp((int)MathF.Floor(t * Scale), 0, PxH), R = Math.Clamp((int)MathF.Ceiling(r * Scale), 0, PxW), B = Math.Clamp((int)MathF.Ceiling(b * Scale), 0, PxH);
        if (R <= L) R = L + 1; if (B <= T) B = T + 1;
        if (L == rl && T == rt && R == rr2 && B == rb) return; rl = L; rt = T; rr2 = R; rb = B;
        N.SetWindowRgn(Hwnd, N.CreateRectRgn(L, T, R, B), false);
    }
    public abstract void Draw();
    public virtual bool Animating => false;
    protected abstract IntPtr Msg(uint m, IntPtr w, IntPtr l, out bool handled);
    protected void Track()
    {
        if (tracking) return; tracking = true;
        var t = new N.TRACKMOUSEEVENT { cbSize = (uint)Marshal.SizeOf<N.TRACKMOUSEEVENT>(), dwFlags = 2, hwndTrack = Hwnd }; N.TrackMouseEvent(ref t);
    }
    protected void Untrack() => tracking = false;

    public Vector2 CursorDip()
    {
        N.GetCursorPos(out var p); N.ScreenToClient(Hwnd, ref p); return new Vector2(p.X / Scale, p.Y / Scale);
    }

    public virtual void Dispose()
    {
        Map.Remove(Hwnd); Dc.Target = null; backBmp?.Dispose(); Dc.Dispose(); Vis.Dispose(); Target.Dispose(); Swap.Dispose(); N.DestroyWindow(Hwnd);
    }
}
