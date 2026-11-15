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
  const eventNames = () => state.language === 'zh-CN'
    ? {news:'新闻',earnings:'财报',ex_dividend:'除息'}
    : {news:'News',earnings:'Earnings',ex_dividend:'Ex-dividend'};
  const eventStyle = type => ({news:{shape:'circle',color:state.theme.colors[0],symbol:'●'},
    earnings:{shape:'square',color:state.theme.colors[2],symbol:'■'},
    ex_dividend:{shape:'arrowDown',color:state.theme.colors[1],symbol:'▼'}}[type]);
  const hideEventTooltip = () => {document.getElementById('event-tooltip').hidden = true;};
  function showEventTooltip(param) {
    const items = (state.events || []).filter(item => filters.has(item.event.type) && finite(item.time)
      && (item.time === param.time || item.event.id === param.hoveredObjectId));
    if (!param.point || state.drawingMode || !items.length) {hideEventTooltip();return;}
    const box = document.getElementById('event-tooltip'), names = eventNames(), zh = state.language === 'zh-CN';
    box.replaceChildren();
    const append = (parent,tag,value,css) => {const node=document.createElement(tag);node.textContent=value;if(css)node.className=css;parent.append(node);return node;};
    append(box,'div',zh ? `${items.length} 项事件` : `${items.length} event${items.length === 1 ? '' : 's'}`,'tooltip-heading');
    const limit=Math.max(1,Math.min(5,Math.floor((root.clientHeight-80)/150)));
    for (const item of items.slice(0,limit)) {
      const e=item.event, row=append(box,'div','','tooltip-event');
      const heading=append(row,'div',eventStyle(e.type).symbol+' '+names[e.type],'tooltip-type');heading.style.color=eventStyle(e.type).color;
      const when=e.published ? new Intl.DateTimeFormat(state.language,{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(e.published))+' ET'
        : e.date ? e.date+(e.endDate?' – '+e.endDate:'') : (zh?'时间未知':'Time unknown');
      append(row,'div',when,'tooltip-meta');
      if (e.title) append(row,'div',e.title,'tooltip-title');
      const confirmation=zh ? {estimated:'预计',source_confirmed:'来源已确认',unverified:'未核实'} : {estimated:'Estimated',source_confirmed:'Source confirmed',unverified:'Unverified'};
      const meta=[e.publisher||e.source,e.type!=='news'?confirmation[e.confirmation]:null].filter(Boolean);
      if(meta.length)append(row,'div',meta.join(' · '),'tooltip-meta');
      const alignment=zh ? {next_bar:'后续 K 线对齐 · 原始事件时间',same_day:'同日 K 线 · 原始事件时间',period_bucket:'周期汇总 · 原始事件时间'}
        : {next_bar:'Next-bar marker · Original time above',same_day:'Same-day marker · Original time above',period_bucket:'Period marker · Original time above'};
      if(alignment[item.alignment])append(row,'div',alignment[item.alignment],'tooltip-meta');
    }
    append(box,'div',items.length>limit ? (zh?`另有 ${items.length-limit} 项 · 点击图表查看详情`:`${items.length-limit} more · Click chart for details`)
      : (zh?'点击展开 ↗︎':'Click to expand ↗︎'),'tooltip-meta');
    box.hidden=false;
    const width=box.offsetWidth, height=box.offsetHeight;
    box.style.left=Math.max(8,Math.min(param.point.x+16,root.clientWidth-width-8))+'px';
    box.style.top=Math.max(8,Math.min(param.point.y+16,root.clientHeight-height-8))+'px';
  }
  root.addEventListener('mouseleave',hideEventTooltip);
  root.addEventListener('wheel',hideEventTooltip,{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideEventTooltip();});
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
      showEventTooltip(param);
    });
    chart.subscribeClick(param => {
      if (!state.drawingMode) {
        const hit = (state.events || []).find(e => filters.has(e.event.type) && (e.event.id === param.hoveredObjectId || e.time === param.time));
        hideEventTooltip();
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
  // Group by original publication day in New York, never by an aligned candle or observation time.
  function eventDay(event) {
    if (!event.published) return event.date || '';
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(event.published));
    const value = type => parts.find(p => p.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function historyPosition() {
    const panel=document.getElementById('timeline'), content=document.getElementById('event-content');
    if(panel.open)content.style.height=Math.max(60,panel.getBoundingClientRect().bottom-content.getBoundingClientRect().top-12)+'px';
    const list=document.getElementById('event-list'), nav=document.getElementById('event-history');
    const days=[...list.querySelectorAll('.event-day')];
    if (!days.length || !list.clientHeight) return;
    const top=list.getBoundingClientRect().top;
    const atEnd=list.scrollHeight>list.clientHeight+1 && list.scrollTop+list.clientHeight>=list.scrollHeight-1;
    const current=atEnd?days.at(-1):days.find(day=>day.getBoundingClientRect().bottom>top+32)||days.at(-1);
    for (const button of nav.children) {
      if (button.dataset.day===current.dataset.day) button.setAttribute('aria-current','date');
      else button.removeAttribute('aria-current');
    }
    const active=nav.querySelector('[aria-current]');
    if(active){const a=active.getBoundingClientRect(),n=nav.getBoundingClientRect();if(a.top<n.top)nav.scrollTop+=a.top-n.top;else if(a.bottom>n.bottom)nav.scrollTop+=a.bottom-n.bottom;}
  }
  let historyFrame=0;
  const scheduleHistory=()=>{if(!historyFrame)historyFrame=requestAnimationFrame(()=>{historyFrame=0;historyPosition();});};
  document.getElementById('event-list').addEventListener('scroll',scheduleHistory,{passive:true});
  document.getElementById('timeline').addEventListener('toggle',scheduleHistory);
  window.addEventListener('resize',scheduleHistory);
  const historySize=new ResizeObserver(scheduleHistory);
  historySize.observe(document.getElementById('timeline'));historySize.observe(document.getElementById('event-tools'));
  function renderEvents() {
    hideEventTooltip();
    const zh = state.language === 'zh-CN';
    const names = eventNames();
    const labels = zh ? {estimated:'预计',source_confirmed:'来源已确认',unverified:'未核实',reported_published:'来源发布时间',timestamp:'精确时间',date:'仅日期',date_range:'日期范围',unknown:'时间未知',outside_chart:'图表范围外',next_bar:'对齐后续 K 线',same_day:'同日 K 线',period_bucket:'周期汇总',exact:'精确对齐',available:'可用',empty:'暂无新闻',not_reported:'来源未提供',unavailable:'不可用'} :
      {estimated:'Estimated',source_confirmed:'Source confirmed',unverified:'Unverified',reported_published:'Reported publication',timestamp:'Timestamp',date:'Date only',date_range:'Date range',unknown:'Time unknown',outside_chart:'Outside chart',next_bar:'Aligned to next bar',same_day:'Same day bar',period_bucket:'Period bucket',exact:'Exact',available:'Available',empty:'No recent news',not_reported:'Not reported',unavailable:'Unavailable'};
    const text = (tag,value,css) => {const node=document.createElement(tag);node.textContent=value;if(css)node.className=css;return node;};
    const date = (e,compact=false) => e.published ? new Intl.DateTimeFormat(state.language,{timeZone:'America/New_York',dateStyle:compact?'short':'medium',timeStyle:'short'}).format(new Date(e.published))+' ET' : e.date ? e.date+(e.endDate ? ' – '+e.endDate : '') : labels.unknown;
    document.getElementById('event-heading').textContent = zh ? '动态' : 'Activity';
    document.getElementById('event-heading').setAttribute('aria-label',zh?'事件与新闻':'Events and news');
    const box = document.getElementById('event-filters');
    if (box.dataset.language !== state.language) {
      box.dataset.language=state.language;box.replaceChildren();
      for (const type of Object.keys(names)) {
        const label = text('label',''), input=document.createElement('input');input.type='checkbox';input.checked=filters.has(type);input.dataset.type=type;
        input.addEventListener('change',()=>{input.checked?filters.add(type):filters.delete(type);renderEvents();});label.append(input);const glyph=text('span',eventStyle(type).symbol);glyph.style.color=eventStyle(type).color;glyph.setAttribute('aria-hidden','true');label.append(glyph,document.createTextNode(names[type]));box.append(label);
      }
    }
    for(const label of box.querySelectorAll('label')) {const input=label.querySelector('input');label.classList.toggle('active',input.checked);label.querySelector('span').style.color=eventStyle(input.dataset.type).color;}
    const status=document.getElementById('event-status');
    status.textContent=state.timelineStatus==='loading' ? (zh?'加载中…':'Loading…') : (state.coverage||[]).filter(c=>c.status==='unavailable').map(c=>names[c.type]+': '+labels.unavailable).join(' · ');
    status.hidden=!status.textContent;
    document.getElementById('event-info-heading').textContent=zh?'数据范围':'Coverage';
    document.getElementById('event-coverage').textContent=(state.coverage||[]).map(c=>names[c.type]+': '+(labels[c.status]||c.status)).join(' · ');
    document.getElementById('event-scope').textContent=zh?'最近新闻与当前日历快照，不含完整历史。':'Recent news and current calendar snapshot; historical coverage is limited.';
    const visible=(state.events||[]).filter(e=>filters.has(e.event.type));
    if(!visible.some(e=>e.event.id===selectedEvent)) selectedEvent=null;
    const groups=new Map();for(const item of visible) if(finite(item.time)){if(!groups.has(item.time))groups.set(item.time,[]);groups.get(item.time).push(item);}
    eventMarkers.setMarkers([...groups].sort((a,b)=>a[0]-b[0]).map(([time,items])=>{
      const types=[...new Set(items.map(i=>i.event.type))], selected=items.some(i=>i.event.id===selectedEvent);
      const style=eventStyle(items[0].event.type);
      return {time,id:items[0].event.id,position:'aboveBar',shape:style.shape,color:selected?state.theme.accent:style.color,
        size:selected?1.5:1,text:(selected?'› ':'')+types.map(type=>names[type]).join(' / ')+(items.length>1?' · '+items.length:'')};
    }));
    const focusedId=document.activeElement?.dataset.eventId;
    const list=document.getElementById('event-list'), nav=document.getElementById('event-history');
    const scroll=list.dataset.key===state.key?list.scrollTop:0, focusedDay=document.activeElement?.dataset.day;
    list.dataset.key=state.key;list.replaceChildren();nav.replaceChildren();
    nav.setAttribute('aria-label',zh?'历史日期导航':'History by date');
    const days=new Map();
    for(const item of visible){const day=eventDay(item.event);if(!days.has(day))days.set(day,[]);days.get(day).push(item);}
    const dayLabel=day=>day?new Intl.DateTimeFormat(state.language,{timeZone:'UTC',month:'short',day:'numeric',weekday:'short',year:'numeric'}).format(new Date(day+'T12:00:00Z')):labels.unknown;
    let dayIndex=0;
    for(const [day,items] of [...days].sort(([a],[b])=>b.localeCompare(a))) {
      const section=text('section','','event-day');section.dataset.day=day;section.id='event-day-'+dayIndex++;
      const heading=text('h3',dayLabel(day),'event-day-heading');heading.append(text('span',String(items.length),'event-day-count'));section.append(heading);list.append(section);
      const jump=text('button','');jump.type='button';jump.dataset.day=day;jump.title=dayLabel(day)+' · '+items.length+(zh?' 项事件':' events');jump.setAttribute('aria-label',(zh?'跳至 ':'Jump to ')+jump.title);jump.setAttribute('aria-controls',section.id);
      jump.addEventListener('click',()=>{list.scrollTop+=section.getBoundingClientRect().top-list.getBoundingClientRect().top;historyPosition();});
      jump.addEventListener('keydown',e=>{const buttons=[...nav.children],index=buttons.indexOf(jump);const target=e.key==='ArrowDown'?buttons[index+1]:e.key==='ArrowUp'?buttons[index-1]:e.key==='Home'?buttons[0]:e.key==='End'?buttons.at(-1):null;if(target){e.preventDefault();target.focus({preventScroll:true});target.click();}});
      nav.append(jump);if(focusedDay===day)jump.focus({preventScroll:true});
      for(const item of items.sort((a,b)=>(b.event.published?Date.parse(b.event.published):-Infinity)-(a.event.published?Date.parse(a.event.published):-Infinity))) {
      const e=item.event,b=text('button','');b.type='button';b.dataset.eventId=e.id;b.setAttribute('aria-pressed',String(e.id===selectedEvent));b.setAttribute('aria-controls','event-detail');
      const icon=text('span',eventStyle(e.type).symbol,'event-type-icon');icon.style.color=eventStyle(e.type).color;icon.setAttribute('aria-hidden','true');b.append(icon);
      b.append(text('span',e.type==='news'?e.title:names[e.type],'event-title'));
      b.setAttribute('aria-label',[names[e.type],e.title,date(e)].filter(Boolean).join(' · '));
      const meta=text('span','','event-row-meta');meta.append(text('span',e.published?new Intl.DateTimeFormat(state.language,{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(e.published))+' ET':date(e,true)));
      if(e.type!=='news')meta.append(text('span',labels[e.confirmation],'event-badge'));
      if(item.alignment==='outside_chart' && e.date)meta.append(text('span',labels.outside_chart,'event-badge'));
      b.append(meta);b.addEventListener('click',()=>{selectedEvent=e.id;renderEvents();});section.append(b);if(focusedId===e.id)b.focus({preventScroll:true});
    }
    }
    nav.hidden=!days.size;document.getElementById('event-feed').classList.toggle('no-history',!days.size);
    list.scrollTop=scroll;scheduleHistory();
    if(selectedEvent && document.getElementById('event-detail').dataset.eventId!==selectedEvent){const selected=[...list.querySelectorAll('[data-event-id]')].find(b=>b.dataset.eventId===selectedEvent);if(selected)list.scrollTop+=selected.getBoundingClientRect().top-list.getBoundingClientRect().top-34;}
    if(!visible.length && state.timelineStatus!=='loading')list.append(text('p',zh?'暂无匹配事件':'No matching events','event-empty'));
    const detail=document.getElementById('event-detail');
    const keepMetadataOpen=detail.dataset.eventId===selectedEvent && detail.querySelector('details')?.open;
    detail.dataset.eventId=selectedEvent||'';detail.replaceChildren();detail.hidden=!selectedEvent;
    document.getElementById('event-content').classList.toggle('has-selection',!!selectedEvent);
    const item=visible.find(e=>e.event.id===selectedEvent);if(!item)return;
    const e=item.event;
    const close=text('button','×','event-close');close.setAttribute('aria-label',zh?'收起详情':'Close details');close.title=zh?'收起详情':'Close details';close.type='button';close.id='event-close';close.addEventListener('click',()=>{const id=selectedEvent;selectedEvent=null;renderEvents();list.querySelector('[data-event-id="'+id+'"]')?.focus({preventScroll:true});});
    detail.append(close,text('p',e.type==='news'?e.title:names[e.type],'event-detail-title'),text('p',date(e)+(e.type!=='news'?' · '+labels[e.confirmation]:''),'event-caption'));
    if(e.publisher||e.source)detail.append(text('p',e.publisher||e.source,'event-caption'));
    if(e.summary)detail.append(text('p',e.summary,'event-summary'));
    if(e.type==='news' && e.url){const b=text('button',zh?'原文 ↗︎':'Original ↗︎','event-read');b.type='button';b.id='event-read';b.addEventListener('click',()=>post({kind:'open-event',key:state.key,id:e.id}).catch(error));detail.append(b);}
    const metadata=document.createElement('details');metadata.className='event-metadata';metadata.open=!!keepMetadataOpen;
    metadata.append(text('summary',zh?'来源与时间':'Source & time'),text('p',labels[e.precision]+' · '+labels[e.confirmation]),text('p',(zh?'来源：':'Source: ')+(e.publisher?e.publisher+' / ':'')+e.source),text('p',labels[item.alignment]));
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
      document.getElementById('fit').textContent = state.language === 'zh-CN' ? '适应' : 'Fit';
      document.getElementById('fit').setAttribute('aria-label',state.language === 'zh-CN' ? '适应图表窗口' : 'Fit chart to window');
      document.getElementById('help-heading').textContent=state.language === 'zh-CN' ? '? 操作' : '? Controls';
      document.getElementById('hint').textContent = state.language === 'zh-CN' ? '滚轮缩放 · 拖动平移 · 拖动面板分隔线调整高度' : 'Scroll to zoom · Drag to pan · Resize pane separators';
      document.getElementById('empty').textContent = state.rows.length ? '' : state.labels.empty;
      document.getElementById('error').style.display = 'none';
      chart.applyOptions({layout: {background: {type: 'solid', color: t.background}, textColor: t.text,panes:{separatorColor:t.border,separatorHoverColor:t.accent}}, crosshair:{vertLine:{color:t.muted,labelBackgroundColor:t.accent},horzLine:{color:t.muted,labelBackgroundColor:t.accent}}, grid: {vertLines: {color: t.grid}, horzLines: {color: t.grid}}, localization: {locale: state.language}, timeScale: {timeVisible: state.intraday}});
      series.candles.applyOptions({upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down, borderUpColor: t.up, borderDownColor: t.down});
      series.candles.setData(state.rows.map(r => !r.incomplete && [r.open,r.high,r.low,r.close].every(finite) ? {time:r.time,open:r.open,high:r.high,low:r.low,close:r.close} : {time:r.time}));
      series.incomplete.applyOptions({color:t.muted,lineVisible:state.rows.length > 0 && state.rows.every(r=>r.incomplete),pointMarkersVisible:!state.rows.every(r=>r.incomplete)});
      series.incomplete.setData(state.rows.map(r => r.incomplete ? point(r, 'close') : {time: r.time}));
      series.eventAnchor.setData(state.rows.map(r => point(r, finite(r.high) ? 'high' : 'close')));
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
        panes.forEach((p,i) => p.setStretchFactor(i === 0 ? Math.max(4, (panes.length - 1) * 1.5) : 1));
      }
      if (saved && previousKey === key && state.preserveView) {chart.timeScale().setVisibleLogicalRange(saved);userRange = saved;}
      else {chart.timeScale().fitContent();userRange = null;}
      if (state.rows.length) showLegend(state.rows[state.rows.length - 1]);
      document.title = 'EasySellPut Charts · ' + state.symbol;
      diagnostic({status:'rendered',historyGroups:document.querySelectorAll('.event-day').length,historyStops:document.getElementById('event-history').children.length,events:(state.events||[]).length,eventMarkers:eventMarkers.markers().length,key:state.key,rows:state.rows.length,candles:series.candles.data().filter(p=>finite(p.open)).length,panes:chart.panes().length,lastMa:series.ma?.data().at(-1)?.value ?? null,background:t.background,up:series.candles.options().upColor,range:chart.timeScale().getVisibleLogicalRange()});
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
