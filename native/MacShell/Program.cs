using System.Collections.Concurrent;
using System.Text.Json;
using Vortice.Direct2D1;

namespace MacShell;

static class Program
{
    static readonly ConcurrentQueue<JsonElement> Queue = new();
    static readonly AutoResetEvent Wake = new(false);
    static readonly object OutLock = new();
    static MenuWindow menu; static DockWindow dock; static PopWindow pop; static IntPtr tgt; static bool darkNow;
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
        AppDomain.CurrentDomain.UnhandledException += (s, e) => { Emit("native:error", "CRASH: " + e.ExceptionObject); Thread.Sleep(200); };
        Gfx.Init(fontDir); Surface.OnError = (m) => Emit("native:error", m);
        new Thread(ReadStdin) { IsBackground = true }.Start();
        Emit("native:ready", new { });

        var evt = Wake.SafeWaitHandle.DangerousGetHandle();
        var last = DateTime.Now;
        while (running)
        {
            while (N.PeekMessage(out var msg, IntPtr.Zero, 0, 0, 1)) { if (msg.message == 0x12) running = false; N.TranslateMessage(ref msg); N.DispatchMessage(ref msg); }
            while (Queue.TryDequeue(out var cmd)) { try { Handle(cmd); } catch (Exception e) { Emit("native:error", e.Message); } }
            dock?.Poll(); menu?.Poll(); pop?.Poll(() => menu != null && menu.OverBar());
            if ((DateTime.Now - last).TotalSeconds >= 1) { last = DateTime.Now; if (menu != null) menu.Dirty = true; }
            bool any = false;
            if (menu != null && (menu.Dirty || menu.Animating)) { Safe(menu.Frame); any = true; }
            if (dock != null && (dock.Dirty || dock.Animating)) { Safe(dock.Frame); any = true; }
            if (pop != null && pop.IsOpen && (pop.Dirty || pop.Animating)) { Safe(pop.Frame); any = true; }
            if (!any) N.MsgWaitForMultipleObjects(1, new[] { evt }, false, ((dock != null && dock.AutoHide) || (menu != null && menu.AutoHide) || (pop != null && pop.IsOpen)) ? 40u : 250u, 0x4FF);
        }
        pop?.Dispose(); menu?.Dispose(); dock?.Dispose();
    }

    static List<PopItem> ParseItems(JsonElement d)
    {
        var li = new List<PopItem>();
        foreach (var e in d.GetProperty("items").EnumerateArray())
            li.Add(new PopItem { Id = Str(e, "id"), Label = Str(e, "label"), Icon = Str(e, "icon"), RIcon = Str(e, "ricon"), Ch = Str(e, "ch"), Sep = Bool(e, "sep"), Hd = Bool(e, "hd"), Checked = Bool(e, "checked"), Dis = Bool(e, "dis"), Slider = Bool(e, "slider"), Media = Bool(e, "media"), Keep = Bool(e, "keep"), Sc = Str(e, "sc"), Value = Num(e, "value") });
        return li;
    }
    static void EnsurePop()
    {
        pop ??= new PopWindow(0, 0, 16, 16)
        {
            Emit = (c, x) => { if (c == "macpop:nact" && x is string s && s.StartsWith("m:")) HMenu.Invoke(s); else Emit(c, x); },
            OnClosed = () => { menu?.ClearOpen(); Emit("macpop:nclosed", null); }
        };
    }
    static void OpenHmPop(int idx, float x, float w, string label)
    {
        if (menu == null || tgt == IntPtr.Zero) return;
        string key = "hm" + idx + label;
        if (pop != null && pop.IsOpen && pop.Key == key) { pop.Close(); return; }
        var li = HMenu.Items(tgt, idx); if (li.Count == 0) { menu.ClearOpen(); return; }
        EnsurePop(); float sc = menu.Scale; int lx = menu.PxX + (int)((x - 4) * sc), ty = menu.PxY + (int)(26 * sc);
        menu.PopOpen = true; pop.Open(li, key, darkNow, lx, false, ty, menu.PxX + menu.PxW, sc);
    }

    static void Safe(Action a) { try { a(); } catch (Exception e) { Emit("native:error", "frame: " + e.GetType().Name + ": " + e.Message); Thread.Sleep(50); } }

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
        if (ch == "prefs" && w == "menu")
        {
            string an = Str(d, "anim") ?? "lively"; PopWindow.Dur = an == "soft" ? 300f : an == "off" ? 1f : 130f;
            if (menu != null) { menu.IslandHalf = Num(d, "island", 104); menu.AutoHide = Bool(d, "menuhide"); menu.Ease = an == "soft" ? .11f : an == "off" ? 1f : .25f; menu.Dirty = true; }
            return;
        }
        if (ch == "macmenu:target")
        {
            if (long.TryParse(Str(d, "hwnd"), out var th)) tgt = new IntPtr(th); darkNow = Bool(d, "dark");
            if (menu != null) { menu.Hm = HMenu.Top(tgt); menu.OpenHm = OpenHmPop; menu.Dirty = true; }
            return;
        }
        if (ch == "pop:close") { if (pop != null && pop.IsOpen) pop.Close(); else Emit("macpop:nclosed", null); return; }
        if (ch == "pop:open" && d.TryGetProperty("ax", out _)) // Dock bağlam menüsü: imlecin üstünde, alt kenarı dock'un üstünde
        {
            Surface s = (Surface)dock ?? menu; if (s == null) return;
            EnsurePop(); darkNow = Bool(d, "dark");
            pop.Open(ParseItems(d), Str(d, "key") ?? "", darkNow, (int)Num(d, "ax"), false, 0, s.PxX + s.PxW, s.Scale, true, (int)Num(d, "ay"));
            return;
        }
        if (ch == "pop:open")
        {
            if (menu == null) return;
            EnsurePop(); darkNow = Bool(d, "dark");
            var li = ParseItems(d);
            float sc = menu.Scale; bool right = Bool(d, "right");
            int ax = right ? menu.PxX + (int)((Num(d, "x") + Num(d, "w")) * sc) : menu.PxX + (int)((Num(d, "x") - 4) * sc), ty = menu.PxY + (int)(26 * sc);
            menu.PopOpen = true; pop.Open(li, Str(d, "key") ?? "", darkNow, ax, right, ty, menu.PxX + menu.PxW, sc);
            return;
        }
        if (ch == "pop:update") { if (pop != null && pop.IsOpen) pop.Update(ParseItems(d)); return; }
        if (ch == "prefs") { if (dock != null) { dock.AutoHide = Bool(d, "autohide"); dock.PreviewOn = !d.TryGetProperty("previews", out var pv) || pv.ValueKind != JsonValueKind.False; dock.SetAnim(Str(d, "anim") ?? "lively"); dock.Dirty = true; } return; }
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
                if (dock == null) { dock = new DockWindow(x, y, pw, ph) { Emit = Emit, Blocked = () => pop != null && pop.IsOpen }; dock.SetBounds(x, y, pw, ph, sc); if (WallData.Bmp != null) dock.SetWall(WallData.Bmp, wallHash.ToString(), WallData.Iw, WallData.Ih, WallData.Sw, WallData.Sh, 0, y / sc); Emit("macdock:ready", null); }
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
                {
                    string url = Str(d, "url"); int h = url == null ? 0 : url.GetHashCode(); bool same = h == wallHash;
                    if (same) { dock?.UpdateWallPos(Num(d, "ox"), Num(d, "oy"), Num(d, "sw"), Num(d, "sh")); }
                    else
                    {
                        var bmp = Glass.LoadDataUrl(url);
                        if (bmp != null)
                        {
                            wallHash = h; var old = WallData.Bmp; WallData.Bmp = bmp; WallData.Iw = Num(d, "iw", bmp.PixelSize.Width); WallData.Ih = Num(d, "ih", bmp.PixelSize.Height); WallData.Sw = Num(d, "sw"); WallData.Sh = Num(d, "sh");
                            dock?.SetWall(bmp, h.ToString(), WallData.Iw, WallData.Ih, WallData.Sw, WallData.Sh, Num(d, "ox"), Num(d, "oy"));
                            old?.Dispose();
                        }
                    }
                }
                break;
        }
    }

    static void Report() => Emit("native:hwnd", new { menu = menu?.Hwnd.ToInt64() ?? 0, dock = dock?.Hwnd.ToInt64() ?? 0 });
}
