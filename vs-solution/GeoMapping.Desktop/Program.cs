using System.Diagnostics;

namespace GeoMapping.Desktop;

/// 地质填图系统 - 桌面端应用程序入口

internal static class Program
{
    public static Process? BackendProcess { get; set; }
    public static readonly int BackendPort = 5050;
    public static readonly string BackendUrl = $"http://localhost:{BackendPort}";

    [STAThread]
    static void Main()
    {
        // DPI 感知 (替代 app.manifest 中的声明)
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (s, e) =>
            MessageBox.Show($"未处理的异常:\n{e.Exception.Message}", "错误",
                MessageBoxButtons.OK, MessageBoxIcon.Error);

        // 启动 Python Flask 后端
        StartBackend();

        // 启动桌面窗口
        try
        {
            Application.Run(new MainForm());
        }
        finally
        {
            StopBackend();
        }
    }

    /// <summary>
    /// 启动 Python Flask 后端服务
    /// </summary>
    static void StartBackend()
    {
        string? backendDir = Path.Combine(AppContext.BaseDirectory, "backend");
        string? appPy = Path.Combine(backendDir, "app.py");

        if (!File.Exists(appPy))
        {
            // 开发模式：从项目目录查找
            backendDir = FindBackendDirectory();
            if (backendDir == null) appPy = null;
            else appPy = Path.Combine(backendDir, "app.py");
        }

        if (!File.Exists(appPy))
        {
            var result = MessageBox.Show(
                "找不到后端服务 (app.py)。\n\n是否仅打开地图界面（部分功能不可用）？",
                "后端服务未找到", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (result == DialogResult.Yes) return;
            Environment.Exit(1);
        }

        string pythonExe = FindPython();

        var psi = new ProcessStartInfo
        {
            FileName = pythonExe,
            Arguments = $"\"{appPy!}\"",
            WorkingDirectory = backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Environment =
            {
                ["FLASK_RUN_PORT"] = BackendPort.ToString(),
                ["PYTHONUNBUFFERED"] = "1",
            }
        };

        try
        {
            BackendProcess = Process.Start(psi);
            Debug.WriteLine($"[Desktop] 后端服务已启动 (PID: {BackendProcess!.Id})");

            // 等待后端就绪
            WaitForBackend().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"启动后端服务失败:\n{ex.Message}\n\n" +
                $"请确保 Python 已安装并已执行:\n" +
                $"pip install flask flask-cors",
                "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static async Task WaitForBackend(int timeoutSeconds = 30)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var sw = Stopwatch.StartNew();

        while (sw.Elapsed.TotalSeconds < timeoutSeconds)
        {
            try
            {
                var resp = await client.GetAsync($"{BackendUrl}/api/health");
                if (resp.IsSuccessStatusCode)
                {
                    Debug.WriteLine($"[Desktop] 后端就绪 ({sw.Elapsed.TotalSeconds:F1}s)");
                    return;
                }
            }
            catch { /* 还未就绪 */ }
            await Task.Delay(1000);
        }

        Debug.WriteLine("[Desktop] 后端启动超时");
    }

    static void StopBackend()
    {
        if (BackendProcess is { HasExited: false })
        {
            Debug.WriteLine("[Desktop] 正在关闭后端服务...");
            try
            {
                BackendProcess.Kill(entireProcessTree: true);
                BackendProcess.WaitForExit(5000);
            }
            catch { }
            BackendProcess.Dispose();
            BackendProcess = null;
        }
    }

    static string FindPython()
    {
        string[] candidates =
        [
            "python",
            "python3",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Python", "Python314", "python.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Python", "Python313", "python.exe"),
            @"C:\Python314\python.exe",
            @"C:\Python313\python.exe",
        ];

        foreach (var candidate in candidates)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = candidate,
                    Arguments = "--version",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using var proc = Process.Start(psi);
                proc!.WaitForExit(5000);
                if (proc.ExitCode == 0)
                    return candidate;
            }
            catch { }
        }
        return "python";
    }

    static string? FindBackendDirectory()
    {
        // 从 VS 开发模式 bin/Debug/net8.0-windows/ → 往上 4 级到项目目录 → 再往上 2 级到根目录
        // 从 exe 发布目录直接往上找
        // bin/Debug/net8.0-windows/ → 5 个 .. → 项目根目录
        string[] searchPaths =
        [
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backend")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "backend")),
            Path.Combine(AppContext.BaseDirectory, "backend"),
        ];

        foreach (var path in searchPaths)
        {
            if (Directory.Exists(path) && File.Exists(Path.Combine(path, "app.py")))
            {
                Debug.WriteLine($"[Desktop] 找到后端: {path}");
                return path;
            }
        }

        Debug.WriteLine("[Desktop] 未找到后端目录");
        return null;
    }
}
