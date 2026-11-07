using System.Runtime.InteropServices;

namespace MacShell;

/// <summary>Klasik (Win32) uygulamaların menü çubuğunu uygulamayı açmadan okur; böylece menüler üstteki panelde gösterilir.</summary>
static class HMenu
{
    [StructLayout(LayoutKind.Sequential)]
    struct MII { public uint cbSize, fMask, fType, fState, wID; public IntPtr hSubMenu, hbmpChecked, hbmpUnchecked, dwItemData, dwTypeData; public uint cch; public IntPtr hbmpItem; }
    [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr h);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr m);
    [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr m, int i);
    [DllImport("user32.dll", EntryPoint = "GetMenuItemInfoW", CharSet = CharSet.Unicode)] static extern bool GetInfo(IntPtr m, uint i, bool byPos, ref MII mi);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    const uint MIIM_STATE = 1, MIIM_ID = 2, MIIM_SUBMENU = 4, MIIM_STRING = 0x40, MIIM_FTYPE = 0x100, MFT_SEPARATOR = 0x800, MFT_OWNERDRAW = 0x100;

    record struct Row(string Text, uint Id, uint State, uint Type, IntPtr Sub);

    static Row Read(IntPtr m, int i)
    {
        var mi = new MII { cbSize = (uint)Marshal.SizeOf<MII>(), fMask = MIIM_STATE | MIIM_ID | MIIM_SUBMENU | MIIM_STRING | MIIM_FTYPE };
        if (!GetInfo(m, (uint)i, true, ref mi)) return new Row("", 0, 0, 0, IntPtr.Zero);
        string t = "";
        if ((mi.fType & (MFT_SEPARATOR | MFT_OWNERDRAW)) == 0 && mi.cch > 0 && mi.cch < 400)
        {
            uint n = mi.cch + 1; var buf = Marshal.AllocHGlobal((int)n * 2);
            try { mi.dwTypeData = buf; mi.cch = n; if (GetInfo(m, (uint)i, true, ref mi)) t = Marshal.PtrToStringUni(buf) ?? ""; }
            finally { Marshal.FreeHGlobal(buf); }
        }
        return new Row(t, mi.wID, mi.fState, mi.fType, mi.hSubMenu);
    }
    static string Clean(string s) => s.Replace("&&", "\0").Replace("&", "").Replace("\0", "&");

    public static List<(string L, int I)> Top(IntPtr hwnd)
    {
        var o = new List<(string, int)>();
        try
        {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return o;
            var m = GetMenu(hwnd); if (m == IntPtr.Zero) return o;
            int n = Math.Min(GetMenuItemCount(m), 14);
            for (int i = 0; i < n; i++)
            {
                var r = Read(m, i); if ((r.Type & MFT_SEPARATOR) != 0 || r.Text.Length == 0 || r.Sub == IntPtr.Zero) continue;
                o.Add((Clean(r.Text.Split('\t')[0]), i));
            }
        }
        catch { }
        return o;
    }

    public static List<PopItem> Items(IntPtr hwnd, int idx)
    {
        var o = new List<PopItem>();
        try
        {
            var top = GetMenu(hwnd); if (top == IntPtr.Zero) return o;
            var sub = GetSubMenu(top, idx); if (sub == IntPtr.Zero) return o;
            Walk(hwnd, sub, 0, o);
            while (o.Count > 0 && o[^1].Sep) o.RemoveAt(o.Count - 1);
        }
        catch { }
        return o;
    }

    static void Walk(IntPtr hw, IntPtr menu, int depth, List<PopItem> o)
    {
        int n = Math.Min(GetMenuItemCount(menu), 60);
        for (int i = 0; i < n && o.Count < 90; i++)
        {
            var r = Read(menu, i);
            if ((r.Type & MFT_SEPARATOR) != 0) { if (o.Count > 0 && !o[^1].Sep) o.Add(new PopItem { Sep = true }); continue; }
            if (r.Text.Length == 0) continue;
            var parts = r.Text.Split('\t'); string label = Clean(parts[0]);
            if (r.Sub != IntPtr.Zero && depth < 2)
            {
                if (o.Count > 0 && !o[^1].Sep) o.Add(new PopItem { Sep = true });
                o.Add(new PopItem { Hd = true, Label = label }); Walk(hw, r.Sub, depth + 1, o);
                if (o.Count > 0 && !o[^1].Sep) o.Add(new PopItem { Sep = true });
                continue;
            }
            o.Add(new PopItem { Id = "m:" + hw.ToInt64() + ":" + r.Id, Label = label, Sc = parts.Length > 1 ? parts[1] : null, Dis = (r.State & 3) != 0, Checked = (r.State & 8) != 0 });
        }
    }

    public static void Invoke(string id)
    {
        var p = id.Split(':'); if (p.Length != 3 || !long.TryParse(p[1], out var h) || !uint.TryParse(p[2], out var c)) return;
        N.PostMessage(new IntPtr(h), 0x111, new IntPtr(c & 0xFFFF), IntPtr.Zero); // WM_COMMAND
    }
}
