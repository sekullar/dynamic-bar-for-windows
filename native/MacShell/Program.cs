using System.Collections.Concurrent;
using System.Text.Json;
using Vortice.Direct2D1;

namespace MacShell;

static class Program
{
    static readonly ConcurrentQueue<JsonElement> Queue = new();
    static readonly AutoResetEvent Wake = new(false);
    static readonly object OutLock = new();
    static MenuWindow menu; static DockWindow dock;
    static bool running = true;
    static int wallHash;
    static StreamWriter stdout;

    static void Emit(string ch, object d)
    {
        lock (OutLock) { try { stdout.WriteLine(JsonSerializer.Serialize(new { ch, d })); stdout.Flush(); } catch { } }
    }

    [STAThread]
    static void Main(string[] args)
    {
        N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
        N.timeBeginPeriod(1);
        stdout = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true };
        string fontDir = Path.Combine(AppContext.BaseDirectory, "fonts");
        Gfx.Init(fontDir); Surface.OnError = (m) => Emit("native:error", m);
        new Thread(ReadStdin) { IsBackground = true }.Start();
        Emit("native:ready", new { });

        var evt = Wake.SafeWaitHandle.DangerousGetHandle();
        var last = DateTime.Now;
        while (running)
        {
            while (N.PeekMessage(out var msg, IntPtr.Zero, 0, 0, 1)) { if (msg.message == 0x12) running = false; N.TranslateMessage(ref msg); N.DispatchMessage(ref msg); }
            while (Queue.TryDequeue(out var cmd)) { try { Handle(cmd); } catch (Exception e) { Emit("native:error", e.Message); } }
            dock?.Poll(); menu?.Poll();
            if ((DateTime.Now - last).TotalSeconds >= 1) { last = DateTime.Now; if (menu != null) menu.Dirty = true; }
            bool any = false;
            if (menu != null && (menu.Dirty || menu.Animating)) { menu.Frame(); any = true; }
            if (dock != null && (dock.Dirty || dock.Animating)) { dock.Frame(); any = true; }
            if (!any) N.MsgWaitForMultipleObjects(1, new[] { evt }, false, (dock != null && dock.AutoHide) ? 40u : 250u, 0x4FF);
        }
        menu?.Dispose(); dock?.Dispose();
    }

    static void ReadStdin()
    {
        try
        {
            using var r = new StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false));
            string line;
            while ((line = r.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                try { Queue.Enqueue(JsonDocument.Parse(line).RootElement.Clone()); Wake.Set(); } catch { }
            }
        }
        catch { }
        running = false; Wake.Set(); N.PostMessage(IntPtr.Zero, 0x12, IntPtr.Zero, IntPtr.Zero);
    }

    static string Str(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static bool Bool(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.True;
    static float Num(JsonElement e, string n, float d = 0) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetSingle() : d;

    static void Handle(JsonElement c)
    {
        string w = Str(c, "w") ?? "all", ch = Str(c, "ch"); c.TryGetProperty("d", out var d);
        if (ch == "force-hover") { dock?.ForceHover(Num(d, "x"), (int)Num(d, "i")); return; }
        if (ch == "prefs") { if (dock != null) { dock.AutoHide = Bool(d, "autohide"); dock.PreviewOn = !d.TryGetProperty("previews", out var pv) || pv.ValueKind != JsonValueKind.False; dock.Dirty = true; } return; }
        if (ch == "quit") { running = false; return; }
        if (ch == "bounds")
        {
            int x = (int)Num(d, "x"), y = (int)Num(d, "y"), pw = (int)Num(d, "w"), ph = (int)Num(d, "h"); float sc = Num(d, "scale", 1);
            if (w == "menu")
            {
                if (menu == null) { menu = new MenuWindow(x, y, pw, ph) { Emit = Emit }; menu.SetBounds(x, y, pw, ph, sc); Emit("macmenu:ready", null); }
                else menu.SetBounds(x, y, pw, ph, sc);
                Report();
            }
            else if (w == "dock")
            {
                if (dock == null) { dock = new DockWindow(x, y, pw, ph) { Emit = Emit }; dock.SetBounds(x, y, pw, ph, sc); Emit("macdock:ready", null); }
                else dock.SetBounds(x, y, pw, ph, sc);
                Report();
            }
            return;
        }
        if (ch == "destroy") { if (w == "menu") { menu?.Dispose(); menu = null; } if (w == "dock") { dock?.Dispose(); dock = null; } return; }
        if (ch == "vis") { bool v = d.ValueKind == JsonValueKind.True; if (w == "menu") menu?.SetVisible(v); else dock?.SetVisible(v); return; }
        if (ch == "top") { if (w == "menu") menu?.Raise(); else dock?.Raise(); return; }
        switch (ch)
        {
            case "macmenu:theme": if (menu != null) { menu.Light = Bool(d, "light"); menu.Dirty = true; } break;
            case "macmenu:menus":
                if (menu != null)
                {
                    var l = new List<MenuEntry>();
                    foreach (var e in d.EnumerateArray()) l.Add(new MenuEntry { Kind = Str(e, "kind"), Label = Str(e, "label") ?? "", Title = Str(e, "title"), I = (int)Num(e, "i") });
                    menu.Menus = l; menu.Dirty = true;
                }
                break;
            case "macpop:closed": menu?.ClearOpen(); break;
            case "macdock:items":
                if (dock != null)
                {
                    var list = new List<DockItem>();
                    foreach (var e in d.GetProperty("items").EnumerateArray())
                    {
                        var it = new DockItem { Key = Str(e, "key"), Name = Str(e, "name"), Running = Bool(e, "running"), Active = Bool(e, "active"), Minimized = Bool(e, "minimized"), Pinned = Bool(e, "pinned"), Pack = Bool(e, "pack"), Count = (int)Num(e, "count") };
                        if (e.TryGetProperty("wins", out var wa) && wa.ValueKind == JsonValueKind.Array) foreach (var we in wa.EnumerateArray()) it.Wins.Add(new WinInfo { H = Str(we, "h"), Title = Str(we, "t"), Min = Bool(we, "m") });
                        string url = Str(e, "icon"); it.IconSig = url == null ? null : url.Length + ":" + url.GetHashCode();
                        var old = dock.Items.FirstOrDefault(o => o.Key == it.Key && o.IconSig == it.IconSig);
                        it.Icon = old?.Icon ?? Glass.LoadDataUrl(url);
                        list.Add(it);
                    }
                    foreach (var o in dock.Items) if (!list.Any(n => n.Icon == o.Icon)) o.Icon?.Dispose();
                    dock.SetItems(Num(d, "size", 40), list);
                }
                break;
            case "macdock:bd":
                if (dock != null)
                {
                    string url = Str(d, "url"); int h = url == null ? 0 : url.GetHashCode();
                    if (h != wallHash || true)
                    {
                        bool same = h == wallHash; wallHash = h;
                        var bmp = same ? null : Glass.LoadDataUrl(url);
                        if (same) { dock.UpdateWallPos(Num(d, "ox"), Num(d, "oy"), Num(d, "sw"), Num(d, "sh")); }
                        else if (bmp != null) dock.SetWall(bmp, h.ToString(), Num(d, "iw", bmp.PixelSize.Width), Num(d, "ih", bmp.PixelSize.Height), Num(d, "sw"), Num(d, "sh"), Num(d, "ox"), Num(d, "oy"));
                    }
                }
                break;
        }
    }

    static void Report() => Emit("native:hwnd", new { menu = menu?.Hwnd.ToInt64() ?? 0, dock = dock?.Hwnd.ToInt64() ?? 0 });
}
