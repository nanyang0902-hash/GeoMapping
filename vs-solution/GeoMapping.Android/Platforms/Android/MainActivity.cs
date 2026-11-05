using Android.App;
using Android.Content.PM;
using Android.OS;
using AndroidGraphics = Android.Graphics;
using AndroidWebkit = Android.Webkit;

namespace GeoMapping.Android;

[Activity(
    Theme = "@style/Maui.SplashTheme",
    MainLauncher = true,
    LaunchMode = LaunchMode.SingleTop,
    ConfigurationChanges = ConfigChanges.ScreenSize
        | ConfigChanges.Orientation
        | ConfigChanges.UiMode
        | ConfigChanges.ScreenLayout
        | ConfigChanges.SmallestScreenSize
        | ConfigChanges.Density,
    ScreenOrientation = ScreenOrientation.Portrait,
    // 硬件加速：Android 级别开启
    HardwareAccelerated = true)]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);

        try
        {
            if (Window != null)
            {
                // 状态栏和导航栏颜色与 App 背景一致
                Window.SetStatusBarColor(AndroidGraphics.Color.ParseColor("#0f172a"));
                Window.SetNavigationBarColor(AndroidGraphics.Color.ParseColor("#0f172a"));

                // FLAG_HARDWARE_ACCELERATED 已由 Activity 属性开启，无需额外设置
            }
        }
        catch { }

#if DEBUG
        // 允许 Chrome DevTools 远程调试 WebView
        try { AndroidWebkit.WebView.SetWebContentsDebuggingEnabled(true); }
        catch { }
#endif
    }
}
