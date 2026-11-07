using System.Runtime.InteropServices;

namespace MacShell;

static class N
{
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const uint WM_DESTROY = 2, WM_SIZE = 5, WM_PAINT = 0xF, WM_ERASEBKGND = 0x14, WM_MOUSEACTIVATE = 0x21, WM_NCHITTEST = 0x84, WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201,
        WM_LBUTTONUP = 0x202, WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205, WM_MOUSELEAVE = 0x2A3, WM_TIMER = 0x113, WM_APP = 0x8000, WM_DISPLAYCHANGE = 0x7E, WM_DPICHANGED = 0x2E0;
    public const int HTTRANSPARENT = -1, HTCLIENT = 1, MA_NOACTIVATE = 3;
    public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40, SWP_NOOWNERZORDER = 0x200;
    public static readonly IntPtr HWND_TOPMOST = new(-1);
    public delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX { public uint cbSize, style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra; public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string lpszMenuName, lpszClassName; public IntPtr hIconSm; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] public struct TRACKMOUSEEVENT { public uint cbSize, dwFlags; public IntPtr hwndTrack; public uint dwHoverTime; }
    [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public uint BatteryLifeTime, BatteryFullLifeTime; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WNDCLASSEX c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowEx(int ex, string cls, string name, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMessage(out MSG m, IntPtr h, uint a, uint b);
    [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG m, IntPtr h, uint a, uint b, uint remove);
    [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr inst, int id);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT t);
    [DllImport("user32.dll")] public static extern IntPtr SetTimer(IntPtr h, IntPtr id, uint ms, IntPtr cb);
    [DllImport("user32.dll")] public static extern bool KillTimer(IntPtr h, IntPtr id);
    [DllImport("user32.dll")] public static extern uint MsgWaitForMultipleObjects(uint n, IntPtr[] h, bool all, uint ms, uint mask);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
    [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string n);
    [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint ms);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int W, H; }
    [StructLayout(LayoutKind.Sequential)] public struct DWM_THUMBNAIL_PROPERTIES { public uint flags; public RECT dest, src; public byte opacity; public int visible, clientOnly; }
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
    [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, int e);
    [DllImport("user32.dll")] public static extern IntPtr SetCapture(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("dwmapi.dll")] static extern int DwmRegisterThumbnail(IntPtr dest, IntPtr src, out IntPtr thumb);
    [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumb);
    [DllImport("dwmapi.dll")] static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref DWM_THUMBNAIL_PROPERTIES p);
    [DllImport("dwmapi.dll")] static extern int DwmQueryThumbnailSourceSize(IntPtr thumb, out SIZE s);
    public static void DwmRegisterAll(IntPtr dest, List<WinInfo> wins, List<IntPtr> thumbs)
    {
        foreach (var w in wins)
        {
            IntPtr t = IntPtr.Zero;
            if (!w.Min && long.TryParse(w.H, out var h) && DwmRegisterThumbnail(dest, new IntPtr(h), out t) == 0) thumbs.Add(t); else thumbs.Add(IntPtr.Zero);
        }
    }
    public static void DwmPlace(List<IntPtr> thumbs, int i, Vortice.RawRectF cell, float scale, float offY, float alpha)
    {
        if (i >= thumbs.Count || thumbs[i] == IntPtr.Zero) return;
        if (DwmQueryThumbnailSourceSize(thumbs[i], out var s) != 0 || s.W <= 0 || s.H <= 0) return;
        float cw = (cell.Right - cell.Left), ch = (cell.Bottom - cell.Top), k = Math.Min(cw / s.W, ch / s.H), w = s.W * k, h = s.H * k;
        float x = cell.Left + (cw - w) / 2, y = cell.Top + (ch - h) / 2 + offY;
        var p = new DWM_THUMBNAIL_PROPERTIES { flags = 0x1 | 0x4 | 0x8 | 0x10, dest = new RECT { L = (int)(x * scale), T = (int)(y * scale), R = (int)((x + w) * scale), B = (int)((y + h) * scale) }, opacity = (byte)(Math.Clamp(alpha, 0, 1) * 255), visible = 1, clientOnly = 1 };
        DwmUpdateThumbnailProperties(thumbs[i], ref p);
    }

    public static int Lo(IntPtr l) => (short)((long)l & 0xFFFF);
    public static int Hi(IntPtr l) => (short)(((long)l >> 16) & 0xFFFF);
}
