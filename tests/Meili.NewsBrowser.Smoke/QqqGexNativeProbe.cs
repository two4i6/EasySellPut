using System.Text.Json;
using System.Runtime.InteropServices;
using System.Reflection;
using Meili.Shared.Services;
using Meili.Automation;
#if WINDOWS_READER
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
#else
using Avalonia.Controls;
using Meili.Mac.Platform;
#endif

internal static partial class Program
{
    // Test-only DOM evaluation of our tokenized local document. No production
    // browser API or remote-page bridge is enabled by this probe.
    private static async Task ProbeQqqPopulated(string directory)
    {
        var data=System.IO.Path.Combine(directory,"gex-fixture");
        System.IO.Directory.CreateDirectory(System.IO.Path.Combine(data,"cache"));
        var start=DateTimeOffset.Parse("2026-01-02T14:30:00Z");
        var input=new {symbol="QQQ",source="synthetic-native-engine-test",captures=Enumerable.Range(0,8).SelectMany(i=>new[]{2,5}.Select(d=>new{valuationAt=start.AddMinutes(2*i),expiry=DateTimeOffset.Parse($"2026-01-0{d}T00:00:00Z").ToUnixTimeSeconds(),spot=600+i*.1,result=new{receivedAt=start.AddMinutes(2*i).AddSeconds(1),options=new[]{new{calls=Enumerable.Range(0,41).Select(j=>new{strike=580+j,impliedVolatility=.2,openInterest=100+j+i}),puts=Enumerable.Range(0,41).Select(j=>new{strike=580+j,impliedVolatility=.22,openInterest=90+j+i})}}}})),bars=Enumerable.Range(0,8).Select(i=>new{timestamp=start.AddMinutes(2*i),open=600+i*.1,high=601+i*.1,low=599+i*.1,close=600+i*.1,volume=100+i})};
        await System.IO.File.WriteAllTextAsync(System.IO.Path.Combine(data,"cache","qqq-gex-input.json"),JsonSerializer.Serialize(input));
        var imported=JsonSerializer.SerializeToElement(await QqqGexCalculationRunner.RunAsync(data));
        if(!imported.TryGetProperty("rows",out var count)||count.GetInt32()!=16)throw new Exception("Native fixture import failed: "+imported);
        using var session=new QqqGexSession(System.IO.Path.Combine(data,"cache","qqq-gex.db"));
#if WINDOWS_READER
        using var browser=new WebView2();
#else
        var browser=new NewsWebView();
#endif
        var window=new Window{Width=1440,Height=1000,Content=browser};
        try
        {
            window.Show();window.Activate();
#if WINDOWS_READER
            var environment=await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null,System.IO.Path.Combine(directory,"gex-populated-browser"));
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.Settings.AreHostObjectsAllowed=false;browser.CoreWebView2.Settings.IsWebMessageEnabled=false;
            browser.CoreWebView2.Navigate(session.PageUri.AbsoluteUri);
#else
            browser.Navigate(session.PageUri.AbsoluteUri);
#endif
            string Title(){
#if WINDOWS_READER
                return browser.CoreWebView2.DocumentTitle;
#else
                return browser.DocumentTitle;
#endif
            }
            async Task Eval(string script){
#if WINDOWS_READER
                await browser.CoreWebView2.ExecuteScriptAsync(script);
#else
                var field=typeof(NewsWebView).GetField("_view",BindingFlags.Instance|BindingFlags.NonPublic)!;
                var view=(IntPtr)field.GetValue(browser)!;
                if(view==IntPtr.Zero)throw new Exception("WKWebView unavailable");
                var text=MacMessage(MacClass("NSString"),MacSelector("alloc"));
                var utf8=Marshal.StringToCoTaskMemUTF8(script);
                try{text=MacMessageArg(text,MacSelector("initWithUTF8String:"),utf8);MacEvaluate(view,MacSelector("evaluateJavaScript:completionHandler:"),text,IntPtr.Zero);}
                finally{Marshal.FreeCoTaskMem(utf8);MacMessage(text,MacSelector("release"));}
                await Task.CompletedTask;
#endif
            }
            // A WKWebView may still be on its initial empty document immediately
            // after Navigate. DOM polling injected there is destroyed by commit.
            await Until(()=>Title().StartsWith("QQQ GEX",StringComparison.Ordinal),"native local document loaded");
            await Eval("window.__gexProbeFetch=[];const probeFetch=window.fetch.bind(window);window.fetch=(...args)=>probeFetch(...args).then(r=>{window.__gexProbeFetch.push({asset:new URL(String(args[0]?.url??args[0]),location.href).pathname.split('/').pop(),status:r.status});if(window.__gexProbeFetch.length>40)window.__gexProbeFetch.shift();return r;});window.__gexProbeErrors=[];addEventListener('error',e=>window.__gexProbeErrors.push(String(e.message).replace(/https?:\\/\\/[^ ]+/g,'[url]')));addEventListener('unhandledrejection',e=>window.__gexProbeErrors.push(String(e.reason).slice(0,300)));window.__gexProbeDone=false");
            var serial=0;
            async Task Check(string condition,string label)
            {
                var marker="gex-native-"+(++serial);
                await Eval("(()=>{const end=Date.now()+25000;const poll=()=>{try{if("+condition+"){document.title="+JsonSerializer.Serialize(marker)+";return;}}catch(e){}if(Date.now()<end)setTimeout(poll,100);};poll();})()");
                try{await Until(()=>Title()==marker,label);}
                catch{
                    await Eval("document.title='GEX_DIAGNOSTIC '+JSON.stringify({visibility:document.visibilityState,focus:document.hasFocus(),ready:document.readyState,scope:[...document.querySelectorAll('select[aria-label=\"到期日范围\"]')].map(s=>({value:s.value,disabled:s.disabled})),observedExposure:localStorage.getItem('qqq-local:observed-exposure:v1'),body:document.body.innerText.slice(0,5000),errors:window.__gexProbeErrors,fetches:window.__gexProbeFetch,resources:performance.getEntriesByType('resource').slice(-20).map(e=>({asset:e.name.split('/').pop(),duration:Math.round(e.duration),bytes:e.transferSize}))})");
                    await Task.Delay(500);Console.Error.WriteLine(Title());throw;
                }
            }
            await Check("document.querySelectorAll('section[aria-label=\"回放 GEX 快照表\"] tbody tr:not([aria-hidden])').length===8","native populated snapshot table");
            foreach(var mode in new[]{"GEX矩阵","Heatmap","K线"})
            {
                await Eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JsonSerializer.Serialize(mode)+").click()");
                await Check("document.querySelectorAll('section[aria-label=\"回放 GEX 快照表\"] tbody tr:not([aria-hidden])').length===8&&!document.body.textContent.includes('QQQ GEX 视图暂时无法显示')","native "+mode);
            }
            await Check("[...document.querySelectorAll('canvas')].some(c=>c.width>0&&c.height>0)","native Kline canvas");
            async Task<JsonElement> Workspace()
            {
                using var service=new AutomationService(new Meili.Core.Settings.DataDirectoryInfo(data,Meili.Core.Settings.DataDirectorySource.CommandLine));
                using var args=JsonDocument.Parse("{\"resource\":\"workspace\",\"length\":262144}");
                var response=await service.ExecuteAsync("get_qqq_gex_view",args.RootElement,false);
                if(!response.GetProperty("success").GetBoolean())throw new Exception("Native application workspace read failed");
                using var decoded=JsonDocument.Parse(Convert.FromBase64String(response.GetProperty("data").GetProperty("bodyBase64").GetString()!));return decoded.RootElement.Clone();
            }
            await Eval("document.querySelector('select[aria-label=\"播放速度\"]').focus()");
            await Check("JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.focus?.label==='播放速度'","native DOM focus observation");
            await Check("JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.focus?.value==='1'","native playback value observation");
            // Allow the existing bounded native preference bridge to acknowledge the observation.
            await Check("document.body.textContent.includes('视图设置保存失败')===false","native preference persistence health");
            JsonElement nativeFocus=default;
            for(var attempt=0;attempt<40;attempt++){var current=await Workspace();if(current.GetProperty("analyticalSelections").TryGetProperty("interaction",out var observed)&&observed.TryGetProperty("focus",out var focus)&&focus.ValueKind==JsonValueKind.Object&&focus.GetProperty("label").GetString()=="播放速度"){nativeFocus=observed.Clone();break;}await Task.Delay(100);}
            if(nativeFocus.ValueKind!=JsonValueKind.Object||nativeFocus.GetProperty("focus").GetProperty("value").GetString()!="1")throw new Exception("Native focus and MCP disagree");
            await Eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Heatmap').click()");
            await Check("document.querySelector('select[aria-label=\"到期日范围\"]')?.disabled===false","native editable expiry scope");
            // Mode activation resets the preferred scope in a passive React effect.
            // Wait across its first paint before sending the next control event.
            await Eval("window.__gexScopeSettled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__gexScopeSettled=true))");
            await Check("window.__gexScopeSettled===true","native scope activation effects settled");
            await Eval("(()=>{const s=document.querySelector('select[aria-label=\"到期日范围\"]');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
            await Check("JSON.parse(localStorage.getItem('qqq-local:observed-exposure:v1')??'null')?.scope==='all'","native all-expiry scope observation");
            await Eval("(()=>{const s=document.querySelector('select[aria-label=\"到期日范围\"]');s.value='selected';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
            await Check("JSON.parse(localStorage.getItem('qqq-local:observed-exposure:v1')??'null')?.scope==='selected'","native selected-expiry scope observation");
            async Task NativeKey(string key)
            {
#if WINDOWS_READER
                var code=key switch{"End"=>35,"ArrowLeft"=>37,"Escape"=>27,_=>throw new ArgumentException("Unsupported test key")};
                foreach(var type in new[]{"rawKeyDown","keyUp"})await browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent",JsonSerializer.Serialize(new{type,key,code=key,windowsVirtualKeyCode=code,nativeVirtualKeyCode=code}));
#else
                var field=typeof(NewsWebView).GetField("_view",BindingFlags.Instance|BindingFlags.NonPublic)!;var view=(IntPtr)field.GetValue(browser)!;var nativeWindow=MacMessage(view,MacSelector("window"));
                if(nativeWindow==IntPtr.Zero)throw new Exception("Native keyboard window unavailable");
                MacMessage(nativeWindow,MacSelector("makeKeyWindow"));var uptime=MacDouble(MacMessage(MacClass("NSProcessInfo"),MacSelector("processInfo")),MacSelector("systemUptime"));
                var (character,code)=key switch{"End"=>("\uF72B",(ushort)119),"ArrowLeft"=>("\uF702",(ushort)123),"Escape"=>("\u001B",(ushort)53),_=>throw new ArgumentException("Unsupported test key")};
                var chars=MacMessage(MacClass("NSString"),MacSelector("alloc"));var utf8=Marshal.StringToCoTaskMemUTF8(character);
                try{
                    chars=MacMessageArg(chars,MacSelector("initWithUTF8String:"),utf8);
                    foreach(var type in new ulong[]{10,11}){
                        var ev=MacKeyEvent(MacClass("NSEvent"),MacSelector("keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:"),type,new KeyPoint(),key=="Escape"?0UL:1UL<<23,uptime,MacMessage(nativeWindow,MacSelector("windowNumber")),IntPtr.Zero,chars,chars,false,code);
                        if(ev==IntPtr.Zero)throw new Exception("Native keyboard event unavailable");MacSendEvent(nativeWindow,MacSelector("sendEvent:"),ev);
                    }
                }finally{Marshal.FreeCoTaskMem(utf8);MacMessage(chars,MacSelector("release"));}
#endif
                await Check("window.__gexNativeKey?.key==="+JsonSerializer.Serialize(key)+"&&window.__gexNativeKey.trusted===true","trusted native "+key);
            }
            await Eval("document.addEventListener('keydown',e=>window.__gexNativeKey={key:e.key,trusted:e.isTrusted},true)");
            // Test-only native-engine/window input, never a production or global input bridge.
            await Check("(()=>{const g=document.querySelector('[data-heatmap-inspector]');return g&&![...document.querySelectorAll('[aria-busy=\"true\"]')].some(e=>e.contains(g));})()","native heatmap computation settled");
#if !WINDOWS_READER
            var keyView=(IntPtr)typeof(NewsWebView).GetField("_view",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(browser)!;var keyWindow=MacMessage(keyView,MacSelector("window"));
            if(keyWindow==IntPtr.Zero)throw new Exception("Native input window unavailable");MacMessage(keyWindow,MacSelector("makeKeyWindow"));MacMessageArg(keyWindow,MacSelector("makeFirstResponder:"),keyView);
#endif
            await Eval("(()=>{const r=document.querySelector('[data-heatmap-inspector] > rect[tabindex]');r.focus();})()");
            await NativeKey("End");
            await Check("JSON.parse(document.querySelector('[data-qqq-inspection]')?.getAttribute('data-qqq-inspection')??'null')?.current?.time>0","native heatmap End selection");
            await Check("JSON.stringify(JSON.parse(document.querySelector('[data-qqq-inspection]').getAttribute('data-qqq-inspection')))===JSON.stringify(JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.heatmapInspection)","native original heatmap and observed state agree");
            async Task<JsonElement> Inspection(Func<JsonElement,bool> ready)
            {
                for(var n=0;n<40;n++){var current=await Workspace();if(current.GetProperty("analyticalSelections").TryGetProperty("interaction",out var observed)&&observed.TryGetProperty("heatmapInspection",out var inspection)&&inspection.ValueKind==JsonValueKind.Object&&ready(inspection))return inspection.Clone();await Task.Delay(100);}
                throw new TimeoutException("Native heatmap selection did not reach application MCP");
            }
            var endInspection=await Inspection(v=>v.GetProperty("current").ValueKind==JsonValueKind.Object);
            var endTime=endInspection.GetProperty("current").GetProperty("time").GetDouble();
            if(endTime<1e12||!endInspection.GetProperty("keyboard").GetBoolean()||endInspection.GetProperty("scenario").GetBoolean())throw new Exception("Native history heatmap units or provenance disagree");
            await NativeKey("ArrowLeft");
            var leftInspection=await Inspection(v=>v.GetProperty("current").ValueKind==JsonValueKind.Object&&v.GetProperty("current").GetProperty("time").GetDouble()<endTime);
            if(leftInspection.GetProperty("current").GetProperty("strike").GetDouble()!=endInspection.GetProperty("current").GetProperty("strike").GetDouble())throw new Exception("Native heatmap horizontal navigation changed strike");
            await NativeKey("Escape");
            await Inspection(v=>v.GetProperty("current").ValueKind==JsonValueKind.Null);
            await Eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='日内情景推演').click()");
            await Check("(()=>{const g=document.querySelector('[data-heatmap-inspector]');return g&&![...document.querySelectorAll('[aria-busy=\"true\"]')].some(e=>e.contains(g));})()","native scenario computation settled");
            foreach(var dark in new[]{false,true}){
                var palette=ThemePalette.For(dark);var (up,down)=palette.UpDown(Meili.Core.Settings.UpDownColorMode.RedUp);ScottPlot.Color C(uint n)=>new((byte)(n>>16),(byte)(n>>8),(byte)n);
                session.UpdatePresentation(ChartPalette.Create(dark,C(up),C(down),C(palette.PrimaryText),C(palette.MutedText),palette));
                await Check("document.documentElement.dataset.theme==='"+(dark?"dark":"light")+"'","native GEX palette update");
                foreach(var width in new[]{1000,1440}){
                    window.Width=width;await Task.Delay(150);
                    await Check("document.querySelectorAll('section[aria-label=\"回放 GEX 快照表\"] tbody tr:not([aria-hidden])').length===8&&!document.body.textContent.includes('QQQ GEX 视图暂时无法显示')","native GEX compact/wide retained data");
                    await Eval("document.querySelector('[data-heatmap-inspector] > rect[tabindex]').focus()");await NativeKey("End");
                    await Inspection(v=>v.GetProperty("scenario").GetBoolean()&&v.GetProperty("current").ValueKind==JsonValueKind.Object);
                    await Check("(()=>{const g=document.querySelector('[data-qqq-inspection-status]'),o=document.querySelector('[data-qqq-inspection-overlay]'),s=g?.querySelector('[role=status]');return g&&o&&o.ownerSVGElement.lastElementChild===o&&g.parentElement===o&&getComputedStyle(s).backgroundColor==='rgb(17, 24, 39)'&&getComputedStyle(s).pointerEvents==='none';})()","native scenario status top layer and pass-through");
                    var output=System.IO.Path.Combine("build","out","ci");System.IO.Directory.CreateDirectory(output);var png=System.IO.Path.Combine(output,$"desktop-smoke-gex-scenario-{width}-{(dark?"dark":"light")}.png");
#if WINDOWS_READER
                    using(var image=System.IO.File.Create(png))await browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png,image);
#else
                    var nativeView=(IntPtr)typeof(NewsWebView).GetField("_view",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(browser)!;var nativeWindow=MacMessage(nativeView,MacSelector("window"));var windowNumber=MacMessage(nativeWindow,MacSelector("windowNumber")).ToInt64();
                    if(windowNumber<=0)throw new Exception("Native screenshot window unavailable");
                    var startInfo=new System.Diagnostics.ProcessStartInfo("/usr/sbin/screencapture"){UseShellExecute=false,RedirectStandardError=true};foreach(var arg in new[]{"-x","-o","-l",windowNumber.ToString(System.Globalization.CultureInfo.InvariantCulture),png})startInfo.ArgumentList.Add(arg);
                    using(var capture=System.Diagnostics.Process.Start(startInfo)??throw new Exception("Native screenshot process unavailable")){using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(15));try{await capture.WaitForExitAsync(deadline.Token);}catch(OperationCanceledException){capture.Kill(true);throw new TimeoutException("Native own-window screenshot timed out");}if(capture.ExitCode!=0)throw new Exception("Native own-window screenshot unavailable: "+await capture.StandardError.ReadToEndAsync());}
#endif
                    var bytes=await System.IO.File.ReadAllBytesAsync(png);if(bytes.Length<1000||!bytes.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))throw new Exception("Native screenshot missing or invalid");
                }
            }
            await Eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='历史快照').click()");
            window.Hide();await Task.Delay(250);window.Show();window.Activate();
            await Check("document.querySelectorAll('section[aria-label=\"回放 GEX 快照表\"] tbody tr:not([aria-hidden])').length===8","native hide/show preserves GEX rows");
            foreach(var tab in new[]{"Gamma 地图","行权价分布","成交持仓","结构事件","活动响应","日内节奏","组合分析","触位统计","Max Pain / Time","ATM IV"})
            {
                var name=JsonSerializer.Serialize(tab);
                await Eval("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==="+name+").click()");
                await Check("[...document.querySelectorAll('[role=tab]')].some(b=>b.textContent.trim()==="+name+"&&b.getAttribute('aria-selected')==='true')","native tab "+tab);
            }
            await Eval("document.title='gex-reload-pending'");await Until(()=>Title()=="gex-reload-pending","native reload sentinel");
            browser.Reload();await Until(()=>Title().StartsWith("QQQ GEX",StringComparison.Ordinal),"native reload new document");
            await Check("document.querySelectorAll('section[aria-label=\"回放 GEX 快照表\"] tbody tr:not([aria-hidden])').length===8","native reload retains snapshots");
            Console.WriteLine("PASS: synthetic populated native QQQ GEX: 3 chart modes, 10 analysis tabs, canvas, DOM focus/trusted native heatmap keyboard through MCP, scope changes, light/dark/compact/wide, hide/show and reload; no live-history/alert claim.");
        }
        finally{window.Content=null;window.Close();}
    }
#if !WINDOWS_READER
    [StructLayout(LayoutKind.Sequential)] private struct KeyPoint{public double X,Y;}
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern IntPtr MacKeyEvent(IntPtr cls,IntPtr selector,ulong type,KeyPoint location,ulong flags,double timestamp,IntPtr windowNumber,IntPtr context,IntPtr characters,IntPtr ignoring,[MarshalAs(UnmanagedType.I1)]bool repeat,ushort keyCode);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern double MacDouble(IntPtr obj,IntPtr selector);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern void MacSendEvent(IntPtr obj,IntPtr selector,IntPtr ev);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_getClass")] private static extern IntPtr MacClass(string name);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="sel_registerName")] private static extern IntPtr MacSelector(string name);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern IntPtr MacMessage(IntPtr obj,IntPtr selector);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern IntPtr MacMessageArg(IntPtr obj,IntPtr selector,IntPtr argument);
    [DllImport("/usr/lib/libobjc.A.dylib",EntryPoint="objc_msgSend")] private static extern void MacEvaluate(IntPtr obj,IntPtr selector,IntPtr script,IntPtr completion);
#endif
}
