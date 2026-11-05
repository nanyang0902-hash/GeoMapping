namespace GeoMapping.Android;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        return new Window(new MainPage())
        {
            Title = "地质填图",
            MinimumWidth = 360,
            MinimumHeight = 640,
        };
    }
}
