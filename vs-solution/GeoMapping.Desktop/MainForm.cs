using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;

namespace GeoMapping.Desktop;

/// <summary>
/// 地质填图系统 - 主窗口
/// 嵌入 WebView2 控件，加载地图界面，提供原生菜单和工具栏
/// </summary>
public partial class MainForm : Form
{
    private WebView2? webView;
    private Panel? loadingPanel;
    private Label? loadingLabel;
    private Label? statusLabel;
    private ToolStrip? toolStrip;
    private bool isInitialized;

    public MainForm()
    {
        InitializeComponent();
        InitializeAsync();
        this.Resize += (s, e) => UpdateWebViewBounds();
    }

    private void InitializeComponent()
    {
        this.Text = "地质填图系统 - Geological Mapping System";
        this.Size = new Size(1400, 900);
        this.MinimumSize = new Size(1024, 700);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        this.BackColor = Color.FromArgb(0x1a, 0x1a, 0x2e);

        // ===== 工具栏 =====
        toolStrip = new ToolStrip
        {
            BackColor = Color.FromArgb(0x16, 0x21, 0x3e),
            ForeColor = Color.FromArgb(0xe2, 0xe8, 0xf0),
            GripStyle = ToolStripGripStyle.Hidden,
            Renderer = new DarkToolStripRenderer(),
        };

        var btnHome = new ToolStripButton("🏠 首页") { ToolTipText = "返回系统首页" };
        btnHome.Click += (s, e) => NavigateTo("/");
        toolStrip.Items.Add(btnHome);

        var btnDesktop = new ToolStripButton("🖥 桌面工作台") { ToolTipText = "打开桌面端工作界面" };
        btnDesktop.Click += (s, e) => NavigateTo("/desktop/");
        toolStrip.Items.Add(btnDesktop);

        var btnMobile = new ToolStripButton("📱 移动端预览") { ToolTipText = "预览移动端界面" };
        btnMobile.Click += (s, e) => NavigateTo("/mobile/");
        toolStrip.Items.Add(btnMobile);

        toolStrip.Items.Add(new ToolStripSeparator());

        var btnBack = new ToolStripButton("◀ 后退") { ToolTipText = "后退" };
        btnBack.Click += (s, e) => webView?.GoBack();
        toolStrip.Items.Add(btnBack);

        var btnForward = new ToolStripButton("▶ 前进") { ToolTipText = "前进" };
        btnForward.Click += (s, e) => webView?.GoForward();
        toolStrip.Items.Add(btnForward);

        var btnReload = new ToolStripButton("🔄 刷新") { ToolTipText = "刷新页面" };
        btnReload.Click += (s, e) => webView?.Reload();
        toolStrip.Items.Add(btnReload);

        toolStrip.Items.Add(new ToolStripSeparator());

        var btnDevTools = new ToolStripButton("🔧 开发工具") { ToolTipText = "打开开发者工具(F12)" };
        btnDevTools.Click += (s, e) => webView?.CoreWebView2?.OpenDevToolsWindow();
        toolStrip.Items.Add(btnDevTools);

        this.Controls.Add(toolStrip);

        // ===== 加载界面 =====
        loadingPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(0x1a, 0x1a, 0x2e),
        };
        loadingLabel = new Label
        {
            Text = "⏳ 正在加载地质填图系统...\n\n请确保后端服务已启动",
            ForeColor = Color.FromArgb(0xa0, 0xae, 0xc0),
            Font = new Font("Microsoft YaHei", 14f),
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Fill,
        };
        loadingPanel.Controls.Add(loadingLabel);
        this.Controls.Add(loadingPanel);

        // ===== 状态栏 =====
        statusLabel = new Label
        {
            Text = "就绪",
            Dock = DockStyle.Bottom,
            Height = 24,
            BackColor = Color.FromArgb(0x16, 0x21, 0x3e),
            ForeColor = Color.FromArgb(0x71, 0x80, 0x96),
            Font = new Font("Microsoft YaHei", 8f),
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(8, 0, 0, 0),
        };
        this.Controls.Add(statusLabel);

        this.FormClosing += (s, e) =>
        {
            webView?.Dispose();
        };
    }

    private async void InitializeAsync()
    {
        try
        {
            webView = new WebView2 { Dock = DockStyle.Fill };
            this.Controls.Add(webView);
            webView.BringToFront();

            var env = await CoreWebView2Environment.CreateAsync();
            await webView.EnsureCoreWebView2Async(env);

            webView.CoreWebView2.Settings.IsScriptEnabled = true;
            webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            webView.NavigationCompleted += (s, e) =>
            {
                this.Invoke(() =>
                {
                    loadingPanel!.Visible = false;
                    statusLabel!.Text = e.IsSuccess ? $"已连接: {Program.BackendUrl}" : $"连接失败: {e.WebErrorStatus}";
                    UpdateWebViewBounds();
                });
                isInitialized = true;
            };

            webView.CoreWebView2.WebMessageReceived += (s, e) =>
            {
                Debug.WriteLine($"[WebView] {e.WebMessageAsJson}");
            };

            webView.CoreWebView2.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;

            // 等待后端就绪或超时
            var backendReady = await CheckBackend(retries: 10);
            string url;

            if (backendReady)
            {
                url = $"{Program.BackendUrl}/desktop/";
                statusLabel!.Text = "✅ 后端已连接";
            }
            else
            {
                // 尝试加载静态文件
                url = FindStaticFrontendPath() ?? $"{Program.BackendUrl}/desktop/";
                statusLabel!.Text = "⚠ 后端未就绪，加载静态页面（创建/保存等功能不可用）";
            }

            webView.Source = new Uri(url);
            Debug.WriteLine($"[Desktop] 加载: {url}");
            UpdateWebViewBounds();
        }
        catch (Exception ex)
        {
            loadingLabel!.Text = "❌ 初始化失败\n\n" + ex.Message + "\n\n" +
                "请确保已安装 WebView2 运行时:\n" +
                "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
        }
    }

    /// <summary>
    /// 查找前端静态文件路径（用于后端不可用时直接加载 HTML）
    /// </summary>
    static string? FindStaticFrontendPath()
    {
        string[] searchPaths = new string[]
        {
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "frontend", "desktop", "index.html")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "frontend", "desktop", "index.html")),
            Path.Combine(AppContext.BaseDirectory, "frontend", "desktop", "index.html"),
        };

        foreach (var p in searchPaths)
        {
            if (File.Exists(p))
            {
                var url = "file:///" + p.Replace('\\', '/');
                Debug.WriteLine($"[Desktop] 静态前端: {url}");
                return url;
            }
        }
        return null;
    }

    private async Task<bool> CheckBackend(int retries = 1)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        for (int i = 0; i < retries; i++)
        {
            try
            {
                var resp = await client.GetAsync($"{Program.BackendUrl}/api/health");
                if (resp.IsSuccessStatusCode) return true;
            }
            catch { }
            if (i < retries - 1) await Task.Delay(1500);
        }
        return false;
    }

    private void UpdateWebViewBounds()
    {
        if (webView == null || !isInitialized) return;

        int top = toolStrip!.Height;
        int bottom = statusLabel!.Height;
        webView.SetBounds(0, top, this.ClientSize.Width, this.ClientSize.Height - top - bottom);
        loadingPanel!.SetBounds(0, top, this.ClientSize.Width, this.ClientSize.Height - top - bottom);
    }

    private async void NavigateTo(string path)
    {
        if (webView?.CoreWebView2 != null)
        {
            webView.CoreWebView2.Navigate($"{Program.BackendUrl}{path}");

            // 移动端预览：页面加载完成后注入移动端模拟脚本
            if (path == "/mobile/")
            {
                webView.NavigationCompleted += OnMobilePreviewLoaded;
            }
        }
    }

    private async void OnMobilePreviewLoaded(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
    {
        if (webView?.CoreWebView2 == null) return;
        // 只执行一次
        webView.NavigationCompleted -= OnMobilePreviewLoaded;

        try
        {
            // 注入移动端视口模拟脚本
            await webView.CoreWebView2.ExecuteScriptAsync(@"
                // 标记为桌面预览模式，移动端 JS 据此显示模拟 GPS 栏
                window.__DESKTOP_PREVIEW__ = true;

                // 通知移动端检测逻辑
                if (typeof MobileApp !== 'undefined' && MobileApp.isDesktopPreview !== undefined) {
                    MobileApp.isDesktopPreview = true;
                }
            ");
            statusLabel!.Text = "移动端预览模式 — 按 F12 → Ctrl+Shift+M 开启设备模拟";
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Mobile Preview] 脚本注入失败: {ex.Message}");
        }
    }

    /// <summary>
    /// 深色主题工具栏渲染
    /// </summary>
    private class DarkToolStripRenderer : ToolStripProfessionalRenderer
    {
        public DarkToolStripRenderer() : base(new DarkColorTable()) { }
    }

    private class DarkColorTable : ProfessionalColorTable
    {
        public override Color ToolStripGradientBegin => Color.FromArgb(0x16, 0x21, 0x3e);
        public override Color ToolStripGradientMiddle => Color.FromArgb(0x16, 0x21, 0x3e);
        public override Color ToolStripGradientEnd => Color.FromArgb(0x16, 0x21, 0x3e);
        public override Color ButtonSelectedGradientBegin => Color.FromArgb(0x2d, 0x4a, 0x6f);
        public override Color ButtonSelectedGradientEnd => Color.FromArgb(0x2d, 0x4a, 0x6f);
        public override Color ButtonPressedGradientBegin => Color.FromArgb(0x3a, 0x7b, 0xd5);
        public override Color ButtonPressedGradientEnd => Color.FromArgb(0x3a, 0x7b, 0xd5);
        public override Color ButtonSelectedBorder => Color.FromArgb(0x00, 0xd2, 0xff);
        public override Color SeparatorDark => Color.FromArgb(0x24, 0x34, 0x47);
        public override Color ToolStripBorder => Color.FromArgb(0x24, 0x34, 0x47);
    }
}
