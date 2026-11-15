using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;

namespace Meili.App.Views.Controls;

/// <summary>Small interruptible chrome feedback; never animates a native browser surface or page layout.</summary>
public static class ComponentMotion
{
    public static readonly DependencyProperty EnabledProperty=DependencyProperty.RegisterAttached("Enabled",typeof(bool),typeof(ComponentMotion),new PropertyMetadata(false,Changed));
    public static bool GetEnabled(DependencyObject value)=>(bool)value.GetValue(EnabledProperty);
    public static void SetEnabled(DependencyObject value,bool enabled)=>value.SetValue(EnabledProperty,enabled);
    private static void Changed(DependencyObject value,DependencyPropertyChangedEventArgs e)
    {
        if(value is not Control control)return;
        if((bool)e.NewValue){control.IsEnabledChanged+=OnEnabledChanged;control.MouseEnter+=OnPointer;control.MouseLeave+=OnPointer;control.PreviewMouseDown+=OnPointer;control.PreviewMouseUp+=OnPointer;}
        else{control.IsEnabledChanged-=OnEnabledChanged;control.MouseEnter-=OnPointer;control.MouseLeave-=OnPointer;control.PreviewMouseDown-=OnPointer;control.PreviewMouseUp-=OnPointer;control.BeginAnimation(UIElement.OpacityProperty,null);}
    }
    private static void OnEnabledChanged(object sender,DependencyPropertyChangedEventArgs e)=>((Control)sender).BeginAnimation(UIElement.OpacityProperty,null);
    private static void OnPointer(object sender,MouseEventArgs e)
    {
        var control=(Control)sender;if(!control.IsEnabled)return;
        var opacity=control.IsMouseOver?(e.RoutedEvent==Mouse.PreviewMouseDownEvent ? .86 : .96):1;
        control.BeginAnimation(UIElement.OpacityProperty,new DoubleAnimation(opacity,TimeSpan.FromMilliseconds(DesignMotion.Reduced?0:DesignTokens.MotionFastMs)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseOut}});
    }
}
