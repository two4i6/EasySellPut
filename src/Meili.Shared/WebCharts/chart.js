/* Local renderer only. All market data and indicator calculations stay in .NET. */
'use strict';
(() => {
  const root = document.getElementById('chart');
  let byTime = new Map(), eventMarkers, selectedEvent, filters = new Set(["news","earnings","ex_dividend"]);
  let chart, state, version = -1, signature = '', key = '', series = {}, priceLines = [], drawingSeries = [];
  let posting = false, pendingHover = null, userRange = null, applying = false;
  const finite = Number.isFinite;
  const post = body => fetch('event', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const diagnostic = body => post({kind: 'diagnostic', ...body}).catch(() => {});
  const error = value => {
    const box = document.getElementById('error');
    box.textContent = state?.language === 'zh-CN' ? '图表加载失败，请重新打开图表页。' : 'Could not load the chart. Reopen the chart page.';
    box.style.display = 'block';
    diagnostic({status: 'error', message: String(value).slice(0, 300)});
  };
  window.addEventListener('error', e => error(e.message));
  window.addEventListener('unhandledrejection', e => error(e.reason));
  function point(row, field, color) {
    return finite(row[field]) ? {time: row.time, value: row[field], ...(color ? {color} : {})} : {time: row.time};
  }
  const eastern = (time, full = false) => {
    if (typeof time !== 'number') return '';
    return new Intl.DateTimeFormat(state?.language || 'en-US', {timeZone: 'America/New_York', ...(full ? {year: 'numeric', month: '2-digit', day: '2-digit'} : {}), ...(state?.intraday ? {hour: '2-digit', minute: '2-digit', hour12: false} : {month: '2-digit', day: '2-digit'})}).format(new Date(time * 1000));
  };
  function line(id, field, title, color, pane = 0, options = {}) {
    if (!series[id]) series[id] = chart.addSeries(LightweightCharts.LineSeries, {title, color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, ...options}, pane);
    series[id].applyOptions({title, color});
    series[id].setData(state.rows.map(r => point(r, field)));
  }
  function build() {
    if (chart) chart.remove();
    series = {}; priceLines = []; drawingSeries = [];
    chart = LightweightCharts.createChart(root, {
      autoSize: true,
      layout: {fontFamily:getComputedStyle(document.body).fontFamily,fontSize:12,background: {type: 'solid', color: state.theme.background}, textColor: state.theme.text, attributionLogo: true, panes: {enableResize: true,separatorColor:state.theme.border,separatorHoverColor:state.theme.accent}},
      rightPriceScale: {borderVisible: false, minimumWidth: 70},
      timeScale: {borderVisible: false, timeVisible: state.intraday, secondsVisible: false, rightOffset: 5, tickMarkFormatter: time => eastern(time)},
      localization: {locale: state.language, timeFormatter: time => eastern(time, true)},
      crosshair: {mode: LightweightCharts.CrosshairMode.Normal,vertLine:{color:state.theme.muted,labelBackgroundColor:state.theme.accent},horzLine:{color:state.theme.muted,labelBackgroundColor:state.theme.accent}},
      grid: {vertLines: {color: state.theme.grid}, horzLines: {color: state.theme.grid}},
    });
    series.candles = chart.addSeries(LightweightCharts.CandlestickSeries, {priceLineVisible: true, borderVisible: false});
    series.eventAnchor = chart.addSeries(LightweightCharts.LineSeries, {lineVisible:false,pointMarkersVisible:false,crosshairMarkerVisible:false,priceLineVisible:false,lastValueVisible:false});
    eventMarkers = LightweightCharts.createSeriesMarkers(series.eventAnchor, []);
    series.incomplete = chart.addSeries(LightweightCharts.LineSeries, {color: state.theme.muted, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 3, priceLineVisible: false, lastValueVisible: false});
    chart.subscribeCrosshairMove(param => {
      if (applying) return;
      const row = byTime.get(param.time);
      pendingHover = {kind: 'crosshair', key: state.key, index: row ? row.index : -1};
      if (row) showLegend(row);
    });
    chart.subscribeClick(param => {
      if (!state.drawingMode) {
        const hit = (state.events || []).find(e => filters.has(e.event.type) && (e.event.id === param.hoveredObjectId || e.time === param.time));
        if (hit) {selectedEvent = hit.event.id; document.getElementById('timeline').open = true; renderEvents();}
        return;
      }
      if (!param.point || typeof param.time !== 'number') return;
      const row = byTime.get(param.time);
      const price = series.candles.coordinateToPrice(param.point.y);
      if (row && finite(price)) post({kind: 'drawing', key: state.key, index: row.index, price}).catch(error);
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {if (!applying && range) userRange = range;});
  }
  function renderEvents() {
    const zh = state.language === 'zh-CN';
    const names = zh ? {news:'新闻',earnings:'财报',ex_dividend:'除息'} : {news:'News',earnings:'Earnings',ex_dividend:'Ex-dividend'};
    const labels = zh ? {estimated:'预计',source_confirmed:'来源已确认',unverified:'未核实',reported_published:'来源发布时间',timestamp:'精确时间',date:'仅日期',date_range:'日期范围',unknown:'时间未知',outside_chart:'图表范围外',next_bar:'对齐后续 K 线',same_day:'同日 K 线',period_bucket:'周期汇总',exact:'精确对齐',available:'可用',empty:'暂无新闻',not_reported:'来源未提供',unavailable:'不可用'} :
      {estimated:'Estimated',source_confirmed:'Source confirmed',unverified:'Unverified',reported_published:'Reported publication',timestamp:'Timestamp',date:'Date only',date_range:'Date range',unknown:'Time unknown',outside_chart:'Outside chart',next_bar:'Aligned to next bar',same_day:'Same day bar',period_bucket:'Period bucket',exact:'Exact',available:'Available',empty:'No recent news',not_reported:'Not reported',unavailable:'Unavailable'};
    const text = (tag,value,css) => {const node=document.createElement(tag);node.textContent=value;if(css)node.className=css;return node;};
    const date = (e,compact=false) => e.published ? new Intl.DateTimeFormat(state.language,{timeZone:'America/New_York',dateStyle:compact?'short':'medium',timeStyle:'short'}).format(new Date(e.published))+' ET' : e.date ? e.date+(e.endDate ? ' – '+e.endDate : '') : labels.unknown;
    document.getElementById('event-heading').textContent = zh ? '事件时间线' : 'Event timeline';
    const box = document.getElementById('event-filters');
    if (box.dataset.language !== state.language) {
      box.dataset.language=state.language;box.replaceChildren();
      for (const type of Object.keys(names)) {
        const label = text('label',''), input=document.createElement('input');input.type='checkbox';input.checked=filters.has(type);input.dataset.type=type;
        input.addEventListener('change',()=>{input.checked?filters.add(type):filters.delete(type);renderEvents();});label.append(input,document.createTextNode(names[type]));box.append(label);
      }
    }
    const status=document.getElementById('event-status');
    status.textContent=state.timelineStatus==='loading' ? (zh?'加载中…':'Loading…') : (state.coverage||[]).filter(c=>c.status==='unavailable').map(c=>names[c.type]+': '+labels.unavailable).join(' · ');
    status.hidden=!status.textContent;
    document.getElementById('event-info-heading').textContent=zh?'数据范围':'Data coverage';
    document.getElementById('event-coverage').textContent=(state.coverage||[]).map(c=>names[c.type]+': '+(labels[c.status]||c.status)).join(' · ');
    document.getElementById('event-scope').textContent=zh?'最近新闻与当前日历快照，不含完整历史。':'Recent news and current calendar snapshot; historical coverage is limited.';
    const visible=(state.events||[]).filter(e=>filters.has(e.event.type));
    if(!visible.some(e=>e.event.id===selectedEvent)) selectedEvent=null;
    const groups=new Map();for(const item of visible) if(finite(item.time)){if(!groups.has(item.time))groups.set(item.time,[]);groups.get(item.time).push(item);}
    eventMarkers.setMarkers([...groups].sort((a,b)=>a[0]-b[0]).map(([time,items])=>({time,id:items[0].event.id,position:'aboveBar',shape:items.some(i=>i.event.id===selectedEvent)?'square':'circle',color:state.theme.accent,text:items.length>1?String(items.length):names[items[0].event.type]})));
    const focusedId=document.activeElement?.dataset.eventId;
    const list=document.getElementById('event-list');list.replaceChildren();
    for(const item of visible) {
      const e=item.event,b=text('button','');b.type='button';b.dataset.eventId=e.id;b.setAttribute('aria-pressed',String(e.id===selectedEvent));b.setAttribute('aria-controls','event-detail');
      b.append(text('span',e.type==='news'?e.title:names[e.type],'event-title'));
      const meta=text('span','','event-row-meta');meta.append(text('span',date(e,true)));
      if(e.type!=='news')meta.append(text('span',labels[e.confirmation],'event-badge'));
      if(item.alignment==='outside_chart' && e.date)meta.append(text('span',labels.outside_chart,'event-badge'));
      b.append(meta);b.addEventListener('click',()=>{selectedEvent=e.id;renderEvents();});list.append(b);if(focusedId===e.id)b.focus({preventScroll:true});
    }
    if(!visible.length && state.timelineStatus!=='loading')list.append(text('p',zh?'暂无匹配事件':'No matching events','event-empty'));
    const detail=document.getElementById('event-detail');
    const keepMetadataOpen=detail.dataset.eventId===selectedEvent && detail.querySelector('details')?.open;
    detail.dataset.eventId=selectedEvent||'';detail.replaceChildren();detail.hidden=!selectedEvent;
    document.getElementById('event-content').classList.toggle('has-selection',!!selectedEvent);
    const item=visible.find(e=>e.event.id===selectedEvent);if(!item)return;
    const e=item.event;
    const close=text('button',zh?'收起详情':'Close details','event-close');close.type='button';close.id='event-close';close.addEventListener('click',()=>{const id=selectedEvent;selectedEvent=null;renderEvents();list.querySelector('[data-event-id="'+id+'"]')?.focus({preventScroll:true});});
    detail.append(close,text('p',e.type==='news'?e.title:names[e.type],'event-detail-title'),text('p',date(e)+(e.type!=='news'?' · '+labels[e.confirmation]:''),'event-caption'));
    if(e.publisher||e.source)detail.append(text('p',e.publisher||e.source,'event-caption'));
    if(e.summary)detail.append(text('p',e.summary,'event-summary'));
    if(e.type==='news' && e.url){const b=text('button',zh?'阅读原文':'Read original','event-read');b.type='button';b.id='event-read';b.addEventListener('click',()=>post({kind:'open-event',key:state.key,id:e.id}).catch(error));detail.append(b);}
    const metadata=document.createElement('details');metadata.className='event-metadata';metadata.open=!!keepMetadataOpen;
    metadata.append(text('summary',zh?'数据详情':'Data details'),text('p',labels[e.precision]+' · '+labels[e.confirmation]),text('p',(zh?'来源：':'Source: ')+(e.publisher?e.publisher+' / ':'')+e.source),text('p',labels[item.alignment]));
    if(e.published)metadata.append(text('p',(zh?'原始时间：':'Original time: ')+e.published));
    if(e.providerFetchedAt)metadata.append(text('p',(zh?'来源下载时间：':'Provider fetched: ')+e.providerFetchedAt));
    if(e.providerAsOf)metadata.append(text('p',(zh?'来源数据时间：':'Provider as of: ')+e.providerAsOf));
    metadata.append(text('p',(zh?'本次读取：':'Observed: ')+e.observedAt));detail.append(metadata);
  }
  function showLegend(row) {
    const fields = [state.show.ma && ['MA', row.ma], state.show.ema && ['EMA', row.ema], state.show.macd && ['MACD', row.macd], state.show.rsi && ['RSI', row.rsi], state.show.kdj && ['K', row.k]];
    document.getElementById('legend').textContent = fields.filter(Boolean).map(([label, value]) => label + ' ' + (finite(value) ? value.toFixed(2) : '—')).join('   ');
  }
  function render(next) {
    const previousKey = key, saved = userRange;
    state = next;
    byTime = new Map(state.rows.map(r => [r.time, r]));
    document.documentElement.lang = state.language;
    const shape = JSON.stringify(state.show);
    const rebuild = !chart || signature !== shape;
    applying = true;
    try {
      if (rebuild) {signature = shape; build();}
      key = state.key;
      if (previousKey !== key) selectedEvent = null;
      const t = state.theme, c = t.colors;
      document.body.style.background = t.background; document.body.style.color = t.text;
      document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
      for (const [name,value] of Object.entries({background:t.background,text:t.text,muted:t.muted,control:t.control,border:t.border,accent:t.accent,'error-background':t.errorBackground,'error-text':t.errorText}))
        if (value) document.documentElement.style.setProperty('--'+name,value);
      document.getElementById('symbol').textContent = state.symbol;
      document.getElementById('fit').textContent = state.language === 'zh-CN' ? '适应窗口' : 'Fit chart';
      document.getElementById('hint').textContent = state.language === 'zh-CN' ? '滚轮缩放 · 拖动平移 · 拖动面板分隔线调整高度' : 'Scroll to zoom · Drag to pan · Resize pane separators';
      document.getElementById('empty').textContent = state.rows.length ? '' : state.labels.empty;
      document.getElementById('error').style.display = 'none';
      chart.applyOptions({layout: {background: {type: 'solid', color: t.background}, textColor: t.text,panes:{separatorColor:t.border,separatorHoverColor:t.accent}}, crosshair:{vertLine:{color:t.muted,labelBackgroundColor:t.accent},horzLine:{color:t.muted,labelBackgroundColor:t.accent}}, grid: {vertLines: {color: t.grid}, horzLines: {color: t.grid}}, localization: {locale: state.language}, timeScale: {timeVisible: state.intraday}});
      series.candles.applyOptions({upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down, borderUpColor: t.up, borderDownColor: t.down});
      series.candles.setData(state.rows.map(r => !r.incomplete && [r.open,r.high,r.low,r.close].every(finite) ? {time:r.time,open:r.open,high:r.high,low:r.low,close:r.close} : {time:r.time}));
      series.incomplete.applyOptions({color:t.muted,lineVisible:state.rows.length > 0 && state.rows.every(r=>r.incomplete),pointMarkersVisible:!state.rows.every(r=>r.incomplete)});
      series.incomplete.setData(state.rows.map(r => r.incomplete ? point(r, 'close') : {time: r.time}));
      series.eventAnchor.setData(state.rows.map(r => point(r, 'close')));
      renderEvents();
      if (state.show.ma) line('ma', 'ma', state.labels.ma, c[0]);
      if (state.show.ema) line('ema', 'ema', state.labels.ema, c[1]);
      if (state.show.boll) {line('bollMiddle','bollMiddle',state.labels.boll,c[2]);line('bollUpper','bollUpper','BOLL ↑',c[2]);line('bollLower','bollLower','BOLL ↓',c[2]);}
      let pane = 0;
      if (state.show.volume) {
        pane++;
        if (!series.volume) series.volume = chart.addSeries(LightweightCharts.HistogramSeries, {title: state.labels.volume, priceFormat: {type: 'volume'}, lastValueVisible: false, priceLineVisible: false}, pane);
        series.volume.applyOptions({title:state.labels.volume});
        series.volume.setData(state.rows.map((r,i) => point(r, 'volume', r.close >= (finite(r.open) ? r.open : state.rows[i-1]?.close ?? r.close) ? t.up : t.down)));
      }
      if (state.show.macd) {
        pane++;
        if (!series.histogram) series.histogram = chart.addSeries(LightweightCharts.HistogramSeries, {title: 'MACD H', priceLineVisible: false, lastValueVisible: false}, pane);
        series.histogram.setData(state.rows.map(r => point(r, 'histogram', r.histogram >= 0 ? t.up : t.down)));
        line('macd','macd',state.labels.macd,c[0],pane);line('signal','signal','Signal',c[1],pane);
      }
      if (state.show.rsi) {
        pane++;line('rsi','rsi',state.labels.rsi,c[2],pane,{autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});
        if (rebuild) for (const price of [30,70]) series.rsi.createPriceLine({price, color:t.muted, lineWidth:1, lineStyle:2, axisLabelVisible:false});
      }
      if (state.show.kdj) {pane++;line('k','k','K',c[0],pane);line('d','d','D',c[1],pane);line('j','j',state.labels.kdj,c[2],pane);}
      if (!series.compare) series.compare = chart.addSeries(LightweightCharts.LineSeries, {color:c[3], lineWidth:2, priceLineVisible:false, lastValueVisible:false});
      series.compare.applyOptions({color:c[3],title:state.compareLabel});
      series.compare.setData(state.compare.map(p => finite(p.value) ? p : {time:p.time}));
      for (const l of priceLines) series.candles.removePriceLine(l);
      for (const s of drawingSeries) chart.removeSeries(s);
      priceLines = [];drawingSeries = [];
      for (const d of state.drawings) {
        if (d.kind === 'HorizontalLine') priceLines.push(series.candles.createPriceLine({price:d.price1,color:c[4],lineWidth:1,lineStyle:2,axisLabelVisible:true}));
        else if (finite(d.time1) && finite(d.time2) && d.time1 !== d.time2) {
          const s = chart.addSeries(LightweightCharts.LineSeries,{color:c[4],lineWidth:2,priceLineVisible:false,lastValueVisible:false});
          s.setData([{time:d.time1,value:d.price1},{time:d.time2,value:d.price2}].sort((a,b)=>a.time-b.time));drawingSeries.push(s);
        }
      }
      if (rebuild) {
        const panes = chart.panes();
        // Relative weights remain stable when autoSize lays out the window after the first frame.
        panes.forEach((p,i) => p.setStretchFactor(i === 0 ? Math.max(1, panes.length - 1) : 1));
      }
      if (saved && previousKey === key && state.preserveView) {chart.timeScale().setVisibleLogicalRange(saved);userRange = saved;}
      else {chart.timeScale().fitContent();userRange = null;}
      if (state.rows.length) showLegend(state.rows[state.rows.length - 1]);
      document.title = 'EasySellPut Charts · ' + state.symbol;
      diagnostic({status:'rendered',events:(state.events||[]).length,eventMarkers:eventMarkers.markers().length,key:state.key,rows:state.rows.length,candles:series.candles.data().filter(p=>finite(p.open)).length,panes:chart.panes().length,lastMa:series.ma?.data().at(-1)?.value ?? null,background:t.background,up:series.candles.options().upColor,range:chart.timeScale().getVisibleLogicalRange()});
    } finally {applying = false;}
  }
  document.getElementById('fit').addEventListener('click',()=>{if(chart){userRange=null;chart.timeScale().fitContent();chart.priceScale('right').applyOptions({autoScale:true});}});
  document.getElementById('attribution').addEventListener('click',e=>{e.preventDefault();post({kind:'attribution'}).catch(error);});
  setInterval(()=>{
    if (!pendingHover || posting) return;
    const body = pendingHover;pendingHover = null;posting = true;
    post(body).catch(()=>{}).finally(()=>posting = false);
  },100);
  async function poll() {
    try {
      const response = await fetch('state?after=' + version, {cache:'no-store'});
      if (response.status === 200) {const update=await response.json();if(update.version>0){render(update.data);version=update.version;}}
      else if (response.status !== 204) throw new Error('Chart state HTTP ' + response.status);
    } catch (e) {error(e);}
    setTimeout(poll,250);
  }
  // Read-only diagnostics for renderer tests; it grants no native capabilities.
  window.meiliChart = {inspect:()=>({chart,series,state,eventMarkers}),render};
  poll();
})();
