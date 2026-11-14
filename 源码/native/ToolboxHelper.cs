using System;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Runtime.InteropServices;

// 全局工具箱的系统小助手：
// - foreground：取当前前台窗口句柄
// - activate：把指定窗口拉回前台
// - paste：向前台窗口发送 Ctrl+V
// - selection：读取当前选中文字（优先 UI Automation，失败时模拟 Ctrl+C）
// 只输出纯文本或 base64，避免中文编码问题。
internal static class ToolboxHelper
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private const int SW_RESTORE = 9;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [STAThread]
    private static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; }
        catch { }

        try
        {
            if (args == null || args.Length == 0)
            {
                Console.WriteLine("ERR:no command");
                return 2;
            }

            switch (args[0].ToLowerInvariant())
            {
                case "ping":
                    Console.WriteLine("ok");
                    return 0;

                case "foreground":
                    Console.WriteLine(GetForegroundWindow().ToInt64().ToString());
                    return 0;

                case "fg":
                    {
                        IntPtr fg = GetForegroundWindow();
                        Console.WriteLine(fg.ToInt64().ToString() + "|" + GetClassNameOf(fg));
                        return 0;
                    }

                case "watch":
                    {
                        IntPtr last = IntPtr.Zero;
                        while (true)
                        {
                            IntPtr current = GetForegroundWindow();
                            if (current != last)
                            {
                                last = current;
                                Console.WriteLine(current.ToInt64().ToString() + "|" + GetClassNameOf(current));
                                Console.Out.Flush();
                            }
                            Thread.Sleep(350);
                        }
                    }

                case "activate":
                    {
                        IntPtr hwnd = ParseHandle(args.Length > 1 ? args[1] : "0");
                        Console.WriteLine(Activate(hwnd) ? "ok" : "fail");
                        return 0;
                    }

                case "paste":
                    {
                        IntPtr target = ParseHandle(args.Length > 1 ? args[1] : "0");
                        int ownPid = 0;
                        if (args.Length > 2) Int32.TryParse(args[2], out ownPid);

                        bool targetValid = target != IntPtr.Zero && IsWindow(target) && IsWindowVisible(target);

                        /* 第一步：等待系统把前台还回来。隐藏面板后通常几十毫秒内就回到用户原来的窗口，
                           这比主动抢前台可靠得多，也更快。 */
                        IntPtr fg = WaitForEditableForeground(target, targetValid, ownPid, 450);

                        /* 第二步：还没回来（例如焦点落到任务栏），再主动把目标窗口拉起来 */
                        if (targetValid && fg != target)
                        {
                            ForceActivate(target);
                            fg = WaitForEditableForeground(target, true, ownPid, 320);
                        }

                        if (ownPid != 0)
                        {
                            uint fgPid;
                            GetWindowThreadProcessId(fg, out fgPid);
                            if (fgPid == (uint)ownPid)
                            {
                                Console.WriteLine("self");
                                return 0;
                            }
                        }

                        if (fg == IntPtr.Zero || IsShellWindow(fg))
                        {
                            Console.WriteLine("nofocus");
                            return 0;
                        }

                        /* 指定了目标就必须落在目标上，不能粘到别的程序里 */
                        if (targetValid && fg != target)
                        {
                            Console.WriteLine("nofocus");
                            return 0;
                        }

                        SendPaste();
                        Console.WriteLine("ok");
                        return 0;
                    }

                case "selection":
                    {
                        string text = GetSelection();
                        if (text == null) text = "";
                        Console.WriteLine("b64:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                        return 0;
                    }

                default:
                    Console.WriteLine("ERR:unknown command");
                    return 2;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("ERR:" + ex.Message);
            return 1;
        }
    }

    private static IntPtr ParseHandle(string raw)
    {
        long value;
        if (Int64.TryParse(raw, out value) && value != 0) return new IntPtr(value);
        return IntPtr.Zero;
    }

    private static string GetClassNameOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return "";
        try
        {
            StringBuilder sb = new StringBuilder(256);
            int len = GetClassName(hwnd, sb, sb.Capacity);
            return len > 0 ? sb.ToString() : "";
        }
        catch
        {
            return "";
        }
    }

    /* 这些是系统外壳窗口，不属于用户正在编辑的程序 */
    private static bool IsShellWindow(IntPtr hwnd)
    {
        string cls = GetClassNameOf(hwnd);
        if (cls.Length == 0) return true;
        switch (cls)
        {
            case "Shell_TrayWnd":
            case "Shell_SecondaryTrayWnd":
            case "NotifyIconOverflowWindow":
            case "TopLevelWindowForOverflowXamlIsland":
            case "#32768":
            case "ForegroundStaging":
            case "Windows.UI.Core.CoreWindow":
            case "XamlExplorerHostIslandWindow":
            case "MultitaskingViewFrame":
            case "TaskSwitcherWnd":
            case "Progman":
            case "WorkerW":
            case "DV2ControlHost":
                return true;
            default:
                return false;
        }
    }

    private static bool Activate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (GetForegroundWindow() == hwnd) return true;

        /* 只把最小化的窗口还原，正常/最大化窗口不要动，避免莫名变成窗口模式 */
        try { if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE); }
        catch { }

        uint pid;
        uint targetThread = GetWindowThreadProcessId(hwnd, out pid);
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        bool attached = false;
        if (targetThread != 0 && foregroundThread != 0 && targetThread != foregroundThread)
        {
            attached = AttachThreadInput(foregroundThread, targetThread, true);
        }

        bool ok = false;
        try { ok = SetForegroundWindow(hwnd); }
        finally
        {
            if (attached) AttachThreadInput(foregroundThread, targetThread, false);
        }

        Thread.Sleep(60);
        return ok || GetForegroundWindow() == hwnd;
    }

    /* 更强的激活：先轻点一下 Alt 解除前台的锁，再拉窗口 */
    private static void ForceActivate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        Activate(hwnd);
        if (GetForegroundWindow() == hwnd) return;

        try
        {
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            Thread.Sleep(15);
            keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(15);
        }
        catch { }
        Activate(hwnd);
        if (GetForegroundWindow() == hwnd) return;

        /* SetForegroundWindow 被系统拦下时的最后手段 */
        try { SwitchToThisWindow(hwnd, true); }
        catch { }
        try { BringWindowToTop(hwnd); }
        catch { }
    }

    private static bool IsEditableForeground(IntPtr hwnd, int ownPid)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (IsShellWindow(hwnd)) return false;
        if (ownPid != 0)
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == (uint)ownPid) return false;
        }
        return true;
    }

    private static IntPtr WaitForEditableForeground(IntPtr target, bool targetValid, int ownPid, int timeoutMs)
    {
        IntPtr last = IntPtr.Zero;
        int waited = 0;
        while (true)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero) last = fg;
            if (targetValid)
            {
                if (fg == target) return fg;
            }
            else if (IsEditableForeground(fg, ownPid))
            {
                return fg;
            }
            if (waited >= timeoutMs) return last;
            Thread.Sleep(25);
            waited += 25;
        }
    }

    private static void SendPaste()
    {
        keybd_event(0x11, 0, 0, UIntPtr.Zero);            // Ctrl down
        Thread.Sleep(12);
        keybd_event(0x56, 0, 0, UIntPtr.Zero);            // V down
        Thread.Sleep(18);
        keybd_event(0x56, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(12);
        keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static void SendCopy()
    {
        keybd_event(0x11, 0, 0, UIntPtr.Zero);            // Ctrl down
        Thread.Sleep(12);
        keybd_event(0x43, 0, 0, UIntPtr.Zero);            // C down
        Thread.Sleep(18);
        keybd_event(0x43, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(12);
        keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static string GetSelection()
    {
        string text = TryUia();
        if (!String.IsNullOrEmpty(text)) return text;
        return ViaClipboard();
    }

    private static string TryUia()
    {
        try
        {
            AutomationElement focused = AutomationElement.FocusedElement;
            if (focused == null) return null;

            object pattern;
            if (!focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return null;

            TextPattern textPattern = pattern as TextPattern;
            if (textPattern == null) return null;

            System.Windows.Automation.Text.TextPatternRange[] ranges = textPattern.GetSelection();
            if (ranges == null || ranges.Length == 0) return null;

            StringBuilder builder = new StringBuilder();
            foreach (System.Windows.Automation.Text.TextPatternRange range in ranges)
            {
                string part = range.GetText(-1);
                if (!String.IsNullOrEmpty(part)) builder.Append(part);
            }

            string result = builder.ToString().Trim();
            return result.Length > 0 ? result : null;
        }
        catch
        {
            return null;
        }
    }

    private static string ViaClipboard()
    {
        IDataObject previous = null;
        try { previous = Clipboard.GetDataObject(); }
        catch { }

        try { Clipboard.Clear(); }
        catch { }

        SendCopy();

        string text = null;
        for (int i = 0; i < 12; i++)
        {
            Thread.Sleep(45);
            try
            {
                if (Clipboard.ContainsText())
                {
                    text = Clipboard.GetText();
                    break;
                }
            }
            catch { }
        }

        try
        {
            if (previous != null) Clipboard.SetDataObject(previous, true);
            else Clipboard.Clear();
        }
        catch { }

        if (text == null) return null;
        text = text.Trim();
        return text.Length > 0 ? text : null;
    }
}
