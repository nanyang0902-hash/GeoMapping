using System.Diagnostics;
using Microsoft.Maui.Controls;

#if ANDROID
using AndroidGraphics = global::Android.Graphics;
using AndroidWebkit = global::Android.Webkit;
using AndroidViews = global::Android.Views;
using AndroidApp = global::Android.App;
#endif

namespace GeoMapping.Android;

#if ANDROID
/// <summary>
/// 自定义 WebChromeClient — 处理 WebView 中的定位权限请求
/// 没有这个，网页中的 navigator.geolocation 会静默失败
/// </summary>
internal class GeoWebChromeClient : AndroidWebkit.WebChromeClient
{
    private readonly AndroidApp.Activity _activity;

    public GeoWebChromeClient(AndroidApp.Activity activity)
    {
        _activity = activity;
    }

    public override void OnGeolocationPermissionsShowPrompt(
        string? origin,
        AndroidWebkit.GeolocationPermissions.ICallback? callback)
    {
        if (origin is not null && callback is not null)
        {
            callback.Invoke(origin, true, false);
        }
    }

    public override void OnPermissionRequest(AndroidWebkit.PermissionRequest? request)
    {
        if (request is not null)
        {
            var resources = request.GetResources();
            if (resources is not null && resources.Length > 0)
            {
                request.Grant(resources);
                return;
            }
        }
        base.OnPermissionRequest(request);
    }
}
#endif

public partial class MainPage : ContentPage
{
    // 10.0.2.2 = Android 模拟器到宿主机的 localhost 映射
    private const string BackendHost = "10.0.2.2";
    private const int BackendPort = 5050;
    private static string BackendUrl => $"http://{BackendHost}:{BackendPort}";

    // 超时配置（毫秒）
    private const int HealthCheckTimeoutMs = 10000;  // 健康检查超时（模拟器网络慢）
    private const int WebViewLoadTimeoutMs = 20000;  // WebView 加载超时
    private const int AutoRetryDelaySeconds = 5;

    private CancellationTokenSource? _cts;
    private bool _isConnecting;
    private bool _isHandlerConfigured;

    // 复用 HttpClient 避免 socket 耗尽
    private static readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromMilliseconds(HealthCheckTimeoutMs)
    };

    public MainPage()
    {
        try
        {
            InitializeComponent();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GeoMapping] InitializeComponent failed: {ex.Message}");
        }

        GeoWebView.Navigated += OnWebViewNavigated;
        GeoWebView.Navigating += OnWebViewNavigating;
        GeoWebView.HandlerChanged += OnWebViewHandlerChanged;

        // 启动流程：先请求定位权限 → 再健康检查加载 WebView
        _ = StartupAsync();
    }

    private async Task StartupAsync()
    {
        await RequestLocationPermissionAsync();
        await CheckBackendAndLoadAsync();
    }

    /// <summary>
    /// 请求 Android 运行时定位权限。
    /// 仅有 manifest 声明不够，API 24+ 必须运行时弹窗授权，
    /// WebView 中的 navigator.geolocation 才不会被系统拦截。
    /// </summary>
    private async Task RequestLocationPermissionAsync()
    {
        var status = await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();
        Debug.WriteLine($"[GeoMapping] 定位权限状态: {status}");

        if (status != PermissionStatus.Granted)
        {
            status = await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
            Debug.WriteLine($"[GeoMapping] 定位权限请求结果: {status}");
        }
    }

    /// <summary>
    /// Android 原生 WebView 配置 — 性能优化
    /// </summary>
    private void OnWebViewHandlerChanged(object? sender, EventArgs e)
    {
        if (_isHandlerConfigured) return;
        _isHandlerConfigured = true;

#if ANDROID
        if (GeoWebView.Handler?.PlatformView is AndroidWebkit.WebView androidWebView)
        {
            var settings = androidWebView.Settings;
            settings.JavaScriptEnabled = true;
            settings.DomStorageEnabled = true;
            settings.DatabaseEnabled = true;
            settings.CacheMode = AndroidWebkit.CacheModes.Default;
            settings.UseWideViewPort = true;
            settings.LoadWithOverviewMode = true;
            settings.BuiltInZoomControls = true;
            settings.DisplayZoomControls = false;
            settings.MixedContentMode = AndroidWebkit.MixedContentHandling.AlwaysAllow;
            settings.JavaScriptCanOpenWindowsAutomatically = false;
            settings.AllowFileAccess = true;
            settings.AllowContentAccess = true;

            // ★ 关键：启用 WebView 地理位置 API
            settings.SetGeolocationEnabled(true);

            // 硬件加速
            androidWebView.SetLayerType(AndroidViews.LayerType.Hardware, null);

            // 暗色背景
            androidWebView.SetBackgroundColor(AndroidGraphics.Color.ParseColor("#0f172a"));

            // ★ 关键：设置自定义 WebChromeClient 处理定位权限
            var activity = AndroidApp.Application.Context as AndroidApp.Activity
                ?? global::Microsoft.Maui.ApplicationModel.Platform.CurrentActivity;
            if (activity is not null)
            {
                androidWebView.SetWebChromeClient(new GeoWebChromeClient(activity));
            }
        }
#endif
    }

    /// <summary>
    /// 主流程：先健康检查 → 再加载 WebView
    /// 这是解决黑屏的核心：不等待 WebView 超时就立即反馈后端状态
    /// </summary>
    private async Task CheckBackendAndLoadAsync()
    {
        if (_isConnecting) return;
        _isConnecting = true;

        CancelPending();

        // 显示加载状态
        RunOnUiThread(() =>
        {
            LoadingOverlay.IsVisible = true;
            ErrorOverlay.IsVisible = false;
            GeoWebView.IsVisible = false;


            StatusDot.TextColor = Color.FromArgb("#f59e0b");
            StatusIndicator.Text = "检测中";
            StatusIndicator.TextColor = Color.FromArgb("#f59e0b");
            StatusText.Text = "正在连接后端服务…";
        });

        // 步骤 1：快速健康检查（3 秒超时）
        var healthOk = await CheckBackendHealthAsync();

        if (!healthOk)
        {
            // 后端不可达 → 立即显示错误页，不等待 WebView
            ShowError("请确认：\n1. 电脑上已运行 python backend/app.py\n2. 后端端口为 5050\n3. 模拟器网络正常");
            return;
        }

        // 步骤 2：后端可达 → 加载 WebView
        RunOnUiThread(() =>
        {
            SetTextIfExists("LoadingText", "正在加载移动填图页面…");
            StatusText.Text = "后端已连接，加载页面中…";
            GeoWebView.IsVisible = true;
        });

        // 设置 WebView 源
        var url = $"{BackendUrl}/mobile/";
        Debug.WriteLine($"[GeoMapping] Loading: {url}");
        GeoWebView.Source = new UrlWebViewSource { Url = url };

        // WebView 加载超时保护
        _cts = new CancellationTokenSource();
        _ = StartWebViewTimeout(_cts.Token);
    }

    /// <summary>
    /// 快速检查后端 /api/health 是否可达
    /// </summary>
    private async Task<bool> CheckBackendHealthAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{BackendUrl}/api/health",
                HttpCompletionOption.ResponseHeadersRead  // 只读头部，更快
            );
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GeoMapping] Health check failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// WebView 加载超时保护
    /// </summary>
    private async Task StartWebViewTimeout(CancellationToken token)
    {
        try
        {
            await Task.Delay(WebViewLoadTimeoutMs, token);

            // 超时：如果还在加载遮罩，说明 WebView 没完成
            if (_isConnecting && LoadingOverlay.IsVisible)
            {
                RunOnUiThread(() =>
                {
                    ShowError("页面加载超时\n请检查后端服务是否正常运行");
                });
            }
        }
        catch (TaskCanceledException)
        {
            // 正常取消
        }
    }

    /// <summary>
    /// WebView 开始导航
    /// </summary>
    private void OnWebViewNavigating(object? sender, WebNavigatingEventArgs e)
    {
        Debug.WriteLine($"[GeoMapping] Navigating: {e.Url}");

        // 外部链接用系统浏览器打开
        if (!string.IsNullOrEmpty(e.Url) &&
            e.Url.StartsWith("http") &&
            !e.Url.Contains(BackendHost))
        {
            e.Cancel = true;
            try { Launcher.OpenAsync(new Uri(e.Url)); } catch { }
        }
    }

    /// <summary>
    /// WebView 导航完成
    /// </summary>
    private void OnWebViewNavigated(object? sender, WebNavigatedEventArgs e)
    {
        Debug.WriteLine($"[GeoMapping] Navigated: {e.Result} — {e.Url}");

        _cts?.Cancel();  // 取消超时

        if (e.Result == WebNavigationResult.Success)
        {
            // 成功 → 隐藏加载遮罩，显示 WebView
            LoadingOverlay.IsVisible = false;
            ErrorOverlay.IsVisible = false;
            GeoWebView.IsVisible = true;

            _ = InjectNativeBridge();

            RunOnUiThread(() =>
            {
                StatusDot.TextColor = Color.FromArgb("#22c55e");
                StatusIndicator.Text = "已连接";
                StatusIndicator.TextColor = Color.FromArgb("#22c55e");
                StatusText.Text = "地质填图 — 移动端";
            });

            _isConnecting = false;
        }
        else
        {
            // 失败 → 显示错误
            ShowError($"页面加载失败 ({e.Result})\n请确认电脑上 python backend/app.py 已启动");
        }
    }

    /// <summary>
    /// 注入 JavaScript 原生桥接
    /// </summary>
    private async Task InjectNativeBridge()
    {
        try
        {
            await GeoWebView.EvaluateJavaScriptAsync(@"
                window.__NATIVE_APP__ = true;
                window.__IS_ANDROID__ = true;
                window.__BACKEND_URL__ = '" + BackendUrl + @"';
                console.log('[Native] Android 桥接已就绪');
            ");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GeoMapping] Bridge inject failed: {ex.Message}");
        }
    }

    /// <summary>
    /// 显示错误页
    /// </summary>
    private void ShowError(string detail)
    {
        RunOnUiThread(() =>
        {
            LoadingOverlay.IsVisible = false;
            GeoWebView.IsVisible = false;
            ErrorOverlay.IsVisible = true;
            ErrorDetail.Text = detail;

            StatusDot.TextColor = Color.FromArgb("#ef4444");
            StatusIndicator.Text = "连接失败";
            StatusIndicator.TextColor = Color.FromArgb("#ef4444");
            StatusText.Text = "无法连接后端服务";

            _isConnecting = false;

            // 启动自动重试
            _cts = new CancellationTokenSource();
            _ = StartAutoRetryCountdown(_cts.Token);
        });
    }

    /// <summary>
    /// 自动重试倒计时
    /// </summary>
    private async Task StartAutoRetryCountdown(CancellationToken token)
    {
        try
        {
            RunOnUiThread(() => AutoRetryLabel.IsVisible = true);

            for (int i = AutoRetryDelaySeconds; i > 0; i--)
            {
                if (token.IsCancellationRequested) return;
                RunOnUiThread(() => AutoRetryLabel.Text = $"{i} 秒后自动重试…");
                await Task.Delay(1000, token);
            }

            if (!token.IsCancellationRequested && !_isConnecting)
            {
                RunOnUiThread(() => AutoRetryLabel.Text = "正在重试…");
                await CheckBackendAndLoadAsync();
            }
        }
        catch (TaskCanceledException) { }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GeoMapping] Auto-retry failed: {ex.Message}");
        }
    }

    /// <summary>
    /// 刷新按钮
    /// </summary>
    private void OnRefreshClicked(object? sender, EventArgs e)
    {
        CancelPending();
        _ = CheckBackendAndLoadAsync();
    }

    /// <summary>
    /// 返回键
    /// </summary>
    protected override bool OnBackButtonPressed()
    {
        if (GeoWebView.CanGoBack)
        {
            GeoWebView.GoBack();
            return true;
        }
        return false;
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        CancelPending();
    }

    /// <summary>
    /// 取消所有待处理任务
    /// </summary>
    private void CancelPending()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;
    }

    private void RunOnUiThread(Action action)
    {
        if (Dispatcher.IsDispatchRequired)
            Dispatcher.Dispatch(action);
        else
            action();
    }

    // 在 XAML 中查找命名控件并安全设置其 Text（如果是 Label 或类似有 Text 的控件）
    private void SetTextIfExists(string name, string text)
    {
        try
        {
            // 尝试解析为 Label
            var lbl = this.FindByName<Label?>(name);
            if (lbl is not null)
            {
                lbl.Text = text;
                return;
            }

            // 尝试解析为 Entry（若需要）
            var entry = this.FindByName<Entry?>(name);
            if (entry is not null)
            {
                entry.Text = text;
                return;
            }
        }
        catch
        {
            // 忽略任何查找错误，保持安全
        }
    }
}
