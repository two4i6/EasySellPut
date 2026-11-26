/* Local renderer only. All market data and indicator calculations stay in .NET. */
'use strict';
(() => {
  const root = document.getElementById('chart');
  let byTime = new Map(), eventMarkers, selectedEvent, selectedEventTime=null, filters = new Set(["news","earnings","ex_dividend"]);
  let liveState, replayIndex = null, replayTime = null, replayTimer = null;
  let setupMarkers, hoveredTime, focusChart = false;
  let readoutFields = [], paneReadouts = [];
  let studyStripSignature = '', studyPending = false;
  const displayMenu = document.getElementById('chart-display');
  const styleSelect = document.getElementById('chart-style');
  const scaleSelect = document.getElementById('chart-scale');
  let quoteVisible = false, quote = null, quotePending = false;
  let sessionBands=[],sessionLayers=[];
  let chart, state, version = -1, signature = '', key = '', series = {}, priceLines = [], drawingSeries = [];
  let posting = false, pendingHover = null, userRange = null, applying = false;
  let editorPreview=null, sameBarWarning = false, draft = null, drawingHover = null, selectedDrawing = -1, drawingRevision = '', drawingBusy = false;
  const finite = Number.isFinite;
  const post = body => fetch('event', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const diagnostic = body => post({kind: 'diagnostic', ...body}).catch(() => {});
  const sidebarSplitter = document.getElementById('sidebar-splitter');
  const sidebarBounds = () => {
    const viewport = window.innerWidth;
    const maximum = Math.min(620, Math.max(0, viewport - Math.min(210, Math.floor(viewport * .48)) - 6));
    return [Math.min(200, maximum), maximum];
  };
  let preferredSidebarWidth = null, sidebarDrag = null, sidebarKeyResize = false;
  function applySidebarWidth(width = preferredSidebarWidth) {
    const [minimum, maximum] = sidebarBounds();
    const desired = width ?? parseFloat(getComputedStyle(document.body).getPropertyValue('--sidebar-default'));
    const clamped = Math.round(Math.min(maximum, Math.max(minimum, desired)));
    document.body.style.setProperty('--sidebar-width', clamped + 'px');
    sidebarSplitter.setAttribute('aria-valuemin', minimum);
    sidebarSplitter.setAttribute('aria-valuemax', maximum);
    sidebarSplitter.setAttribute('aria-valuenow', clamped);
    return clamped;
  }
  function saveSidebarWidth() {
    if (preferredSidebarWidth === null) return;
    post({kind:'resize-sidebar', width:Math.max(200, preferredSidebarWidth)}).catch(() => {});
  }
  sidebarSplitter.addEventListener('pointerdown', event => {
    if (event.button !== 0 || sidebarDrag) return;
    sidebarDrag = {pointerId:event.pointerId, x:event.clientX, width:applySidebarWidth(), previous:preferredSidebarWidth};
    sidebarSplitter.focus({preventScroll:true});
    sidebarSplitter.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-sidebar');
    event.preventDefault();
  });
  sidebarSplitter.addEventListener('pointermove', event => {
    if (event.pointerId !== sidebarDrag?.pointerId || event.clientX === sidebarDrag.x && preferredSidebarWidth === sidebarDrag.previous) return;
    preferredSidebarWidth = applySidebarWidth(sidebarDrag.width + sidebarDrag.x - event.clientX);
  });
  function finishSidebarDrag(event, save) {
    if (event.pointerId !== sidebarDrag?.pointerId) return;
    const previous = sidebarDrag.previous;
    sidebarDrag = null;
    document.body.classList.remove('resizing-sidebar');
    if (!save) { preferredSidebarWidth = previous; applySidebarWidth(); }
    else if (preferredSidebarWidth !== previous) saveSidebarWidth();
  }
  sidebarSplitter.addEventListener('pointerup', event => finishSidebarDrag(event, true));
  sidebarSplitter.addEventListener('pointercancel', event => finishSidebarDrag(event, false));
  sidebarSplitter.addEventListener('lostpointercapture', event => finishSidebarDrag(event, false));
  const sidebarKeys = ['ArrowLeft','ArrowRight','Home','End'];
  sidebarSplitter.addEventListener('keydown', event => {
    if (!sidebarKeys.includes(event.key) || sidebarDrag) return;
    event.preventDefault();
    const [minimum, maximum] = sidebarBounds();
    const current = applySidebarWidth();
    const width = event.key === 'Home' ? minimum : event.key === 'End' ? maximum :
      current + (event.key === 'ArrowLeft' ? 16 : -16);
    preferredSidebarWidth = applySidebarWidth(width);
    sidebarKeyResize = true;
  });
  function finishSidebarKeyResize() {
    if (!sidebarKeyResize) return;
    sidebarKeyResize = false;
    saveSidebarWidth();
  }
  sidebarSplitter.addEventListener('keyup', event => {
    if (sidebarKeys.includes(event.key)) finishSidebarKeyResize();
  });
  sidebarSplitter.addEventListener('blur', finishSidebarKeyResize);
  window.addEventListener('resize', () => applySidebarWidth());
  const error = value => {
    const box = document.getElementById('error');
    box.textContent = state?.language === 'zh-CN' ? '图表加载失败，请重新打开图表页。' : 'Could not load the chart. Reopen the chart page.';
    box.style.display = 'block';
    diagnostic({status: 'error', message: String(value).slice(0, 300)});
  };
  window.addEventListener('error', e => error(e.message));
  window.addEventListener('unhandledrejection', e => error(e.reason));
  const drawingTools = {
    HorizontalLine:['水平线','Horizontal line'],
    TrendLine:['趋势线','Trend line'],
    HorizontalRay:['水平射线','Horizontal ray'],
    VerticalLine:['垂直线','Vertical line'],
    Rectangle:['矩形','Rectangle'],
    FibonacciRetracement:['斐波那契回撤','Fibonacci retracement'],
    LongPosition:['多头仓位','Long position'],
    ShortPosition:['空头仓位','Short position'],
    PriceRange:['价格区间','Price range']
  };
  const positionTool = kind => kind==='LongPosition'||kind==='ShortPosition';
  const twoAnchors = kind => ['TrendLine','Rectangle','FibonacciRetracement','PriceRange'].includes(kind) || positionTool(kind);
  const distinctPrices = kind => ['Rectangle','FibonacciRetracement','PriceRange'].includes(kind);
  const timed = kind => kind!=='HorizontalLine' && kind!=='PriceRange';
  const targetSide = (kind,entry,target) => kind==='LongPosition'?target>entry:target<entry;
  const stopSide = (kind,entry,stop) => kind==='LongPosition'?stop<entry:stop>entry;
  let targetDraft = null;
  const toolName = kind => drawingTools[kind]?.[state.language==='zh-CN'?0:1] ?? kind;
  const drawingMenu = document.getElementById('draw-tools');
  const drawingMenuLabel = document.getElementById('draw-tools-label');
  const drawingMenuItems = document.getElementById('draw-tool-options');
  for (const kind of Object.keys(drawingTools)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.drawingTool = kind;
    button.addEventListener('click', async () => {
      drawingMenu.open = false;
      root.focus();
      try {
        const response = await post({kind:'drawing-start',key:state.key,mode:kind});
        if (!response.ok) throw new Error('Drawing tool rejected');
      } catch (e) { error(e); }
    });
    drawingMenuItems.append(button);
  }
  function renderDrawingMenu() {
    const label = state.language==='zh-CN' ? '画线' : 'Draw';
    const text = document.createElement('span');
    text.textContent = label;
    drawingMenuLabel.replaceChildren(meiliIcons.svg('Pencil',14),text);
    drawingMenuLabel.setAttribute('aria-label',label);
    for (const button of drawingMenuItems.children) {
      const kind = button.dataset.drawingTool;
      button.textContent = toolName(kind);
      button.disabled = !state.rows.length;
      button.setAttribute('aria-pressed',String(state.drawingMode===kind));
    }
  }

  let selectionDown=null, drawingDown=null, drawingRequests=Promise.resolve(), finishingDrawing=false;
  function mouseDrawingPoint(event){const rect=root.getBoundingClientRect(),point={x:event.clientX-rect.left,y:event.clientY-rect.top};return drawingPoint({point,time:chart.timeScale().coordinateToTime(point.x),paneIndex:0});}
  root.addEventListener('mousedown',event=>{
    if(!chart || !state)return;
    if(event.button!==0)return;
    if(!state?.drawingMode){if(!event.target.closest('#drawing-panel'))selectionDown={x:event.clientX,y:event.clientY};return;}
    const point=mouseDrawingPoint(event);if(!point)return;
    drawingDown={x:event.clientX,y:event.clientY};event.preventDefault();event.stopPropagation();
  },true);
  root.addEventListener('mouseup',event=>{
    if(!chart || !state)return;
    if(!state.drawingMode){
      const down=selectionDown;selectionDown=null;
      if(!down || event.button!==0 || Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;
      const rect=root.getBoundingClientRect(),point={x:event.clientX-rect.left,y:event.clientY-rect.top};
      if(point.x<0 || point.x>=chart.timeScale().width())return;
      const hit=drawingHit(point);if(hit>=0){selectDrawing(hit);root.focus();}return;
    }
    if(!drawingDown || event.button!==0)return;
    const down=drawingDown;drawingDown=null;event.preventDefault();event.stopPropagation();
    if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5 || finishingDrawing)return;
    const point=mouseDrawingPoint(event);if(!point)return;root.focus();
    sameBarWarning = false;
    const kind = state.drawingMode, position = positionTool(kind);
    if (draft) {
      if (timed(kind) && !targetDraft && draft.time===point.time) sameBarWarning='time';
      else if (distinctPrices(kind) && draft.price===point.price) sameBarWarning='price';
      else if (position && !targetDraft && !targetSide(kind,draft.price,point.price)) sameBarWarning='target';
      else if (position && targetDraft && !stopSide(kind,draft.price,point.price)) sameBarWarning='stop';
      if (sameBarWarning) { drawOverlay(); return; }
    }
    finishingDrawing=!twoAnchors(kind)||!!draft&&(!position||!!targetDraft);
    if(twoAnchors(kind)&&!draft)draft=point;
    else if(position&&!targetDraft)targetDraft=point;
    const body={kind:'drawing',key:state.key,mode:state.drawingMode,epoch:state.drawingEpoch,index:point.index,price:point.price};
    drawingRequests=drawingRequests.then(()=>post(body)).then(response=>{if(!response.ok)throw new Error('Drawing request rejected');}).catch(e=>{finishingDrawing=false;error(e);});drawOverlay();
  },true);
  window.addEventListener('mouseup',()=>{drawingDown=null;selectionDown=null;});
  const overlay = document.getElementById('drawing-overlay');
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const storedShapes = document.createElementNS(svgNamespace,'g');
  const activeShapes = document.createElementNS(svgNamespace,'g');
  overlay.append(storedShapes,activeShapes);
  let storedDrawings, storedDrawingView;
  const drawingPanel = document.getElementById('drawing-panel');
  function drawingPoint(param) {
    if (!param.point || param.paneIndex !== undefined && param.paneIndex !== 0 || param.point.y < 0 || param.point.y >= chart.panes()[0].getHeight() || param.point.x < 0 || param.point.x >= chart.timeScale().width()) return null;
    const row = byTime.get(param.time), price = series.candles.coordinateToPrice(param.point.y);
    return row && finite(price) && price >= 0 && price <= 1e12 ? {time:row.time,index:row.index,price:Number(price.toFixed(6))} : null;
  }
  function drawingGeometry(drawing, width, height) {
    const x = time => time == null ? null : chart.timeScale().timeToCoordinate(time);
    const y = price => finite(price) ? series.candles.priceToCoordinate(price) : null;
    const first = {x:x(drawing.time1), y:y(drawing.price1)};
    const second = {x:x(drawing.time2), y:y(drawing.price2)};
    const segment = (ax,ay,bx,by) => [{x:ax,y:ay},{x:bx,y:by}];
    switch (drawing.kind) {
      case 'HorizontalLine': {
        const line = segment(0,first.y,width,first.y);
        return {segments:[line],handles:line};
      }
      case 'PriceRange': {
        const bounds = [drawing.price1,drawing.price2].filter(finite).sort((a,b)=>b-a);
        if (bounds.length !== 2) return null;
        const zh = state.language === 'zh-CN';
        const lines = bounds.map(price=>y(price));
        return {
          segments:lines.map(at=>segment(0,at,width,at)),
          handles:lines.map(at=>({x:width/2,y:at})),
          labels:bounds.map((price,i)=>({x:8,y:Math.max(12,lines[i]-4),text:(zh?['上沿','下沿']:['Upper','Lower'])[i]+' '+price.toFixed(2)}))
        };
      }
      case 'HorizontalRay':
        if (!finite(first.x)) return null;
        return {segments:[segment(first.x,first.y,width,first.y)],handles:[first]};
      case 'VerticalLine':
        if (!finite(first.x)) return null;
        return {segments:[segment(first.x,0,first.x,height)],handles:[{x:first.x,y:height/2}]};
    }
    if (![first.x,first.y,second.x,second.y].every(finite)) return null;
    const left = Math.min(first.x,second.x), right = Math.max(first.x,second.x);
    if (positionTool(drawing.kind)) {
      const zh = state.language==='zh-CN';
      const profit = state.theme.profit ?? '#4F9169', loss = state.theme.loss ?? '#B15353';
      const stop = y(drawing.stopPrice), hasStop = finite(stop);
      const zones = [[second.y,profit], ...(hasStop?[[stop,loss]]:[])];
      const areas = zones.map(([at,color])=>({x:left,y:Math.min(first.y,at),width:right-left,height:Math.abs(first.y-at),color}));
      const ratio = hasStop ? Math.abs(drawing.price2-drawing.price1)/Math.abs(drawing.stopPrice-drawing.price1) : null;
      const labels = [[first.y,(zh?'开仓 ':'Entry ')+drawing.price1.toFixed(2)+(finite(ratio)?' · '+(zh?'盈亏比 ':'R/R ')+ratio.toFixed(2):'')],
        [second.y,(zh?'止盈 ':'Target ')+drawing.price2.toFixed(2),profit]];
      if (hasStop) labels.push([stop,(zh?'止损 ':'Stop ')+drawing.stopPrice.toFixed(2),loss]);
      return {areas,segments:[segment(left,first.y,right,first.y),...zones.map(([at])=>segment(left,at,right,at)),
          segment(left,Math.min(...labels.map(([at])=>at)),left,Math.max(...labels.map(([at])=>at))),
          segment(right,Math.min(...labels.map(([at])=>at)),right,Math.max(...labels.map(([at])=>at)))],
        handles:[first,second,...(hasStop?[{x:second.x,y:stop}]:[])],
        labels:labels.map(([at,text,color])=>({x:Math.max(4,left+4),y:Math.max(12,at-4),text,color}))};
    }
    if (drawing.kind === 'Rectangle') {
      const top = Math.min(first.y,second.y), bottom = Math.max(first.y,second.y);
      return {segments:[segment(left,top,right,top),segment(right,top,right,bottom),
          segment(right,bottom,left,bottom),segment(left,bottom,left,top)],
        area:{x:left,y:top,width:right-left,height:bottom-top},handles:[first,second]};
    }
    if (drawing.kind === 'FibonacciRetracement') {
      const levels = [0,.236,.382,.5,.618,.786,1].map(ratio => {
        const price = drawing.price2 + (drawing.price1-drawing.price2)*ratio;
        return {at:y(price),text:Number((100*ratio).toFixed(1))+'%  '+price.toFixed(2)};
      }).filter(level => finite(level.at));
      return {segments:levels.map(level=>segment(left,level.at,right,level.at)),
        labels:levels.map(level=>({x:Math.max(4,left+4),y:Math.max(12,level.at-4),text:level.text})),
        handles:[first,second]};
    }
    return {segments:[[first,second]],handles:[first,second]};
  }
  function drawOverlay() {
    activeShapes.replaceChildren(); if(!chart || !state)return;
    const width=chart.timeScale().width(),height=chart.panes()[0].getHeight();
    overlay.style.width=width+'px';overlay.style.height=height+'px';
    let layer = activeShapes;
    function shape(tag,attrs,text){
      const node=document.createElementNS(svgNamespace,tag);
      for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
      if(text)node.textContent=text;
      layer.append(node);
    }
    const color = state.theme.accent;
    function paint(drawing,preview=false,handles=false) {
      const geometry = drawingGeometry(drawing,width,height);
      if (!geometry) return;
      if (geometry.area) shape('rect',{...geometry.area,fill:color,'fill-opacity':.12});
      for (const {color:fill,...area} of geometry.areas ?? [])
        shape('rect',{...area,fill,class:'position-zone','fill-opacity':.22});
      for (const [a,b] of geometry.segments) {
        if (![a.x,a.y,b.x,b.y].every(finite)) continue;
        shape('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':handles?2:1,...(preview?{'stroke-dasharray':'5 4'}:{})});
      }
      for (const label of geometry.labels ?? []) shape('text',{x:label.x,y:label.y,class:'drawing-level',fill:label.color ?? color},label.text);
      if (handles) for (const p of geometry.handles) {
        if(finite(p.x)&&finite(p.y))shape('circle',{cx:p.x,cy:p.y,r:4,fill:state.theme.background,stroke:color,'stroke-width':2});
      }
    }
    const visible = chart.timeScale().getVisibleLogicalRange();
    const view = JSON.stringify([width,height,visible?.from,visible?.to,scaleSelect.value,
      series.candles.coordinateToPrice(0),series.candles.coordinateToPrice(height),selectedDrawing,state.drawingMode,color,state.theme.profit,state.theme.loss]);
    if (storedDrawings !== state.drawings || storedDrawingView !== view) {
      storedDrawings = state.drawings;
      storedDrawingView = view;
      storedShapes.replaceChildren();
      layer = storedShapes;
      state.drawings.forEach((drawing,index)=>{
        if (drawing.kind==='HorizontalLine'||drawing.kind==='TrendLine') return;
        if (index!==selectedDrawing || state.drawingMode) paint(drawing);
      });
      layer = activeShapes;
    }
    const drawing=editorPreview||state.drawings[selectedDrawing];
    if(drawing && !state.drawingMode)paint(drawing,!!editorPreview,true);
    if (state.drawingMode) {
      const kind=state.drawingMode, first=draft??drawingHover;
      if (first && (!twoAnchors(kind) || draft && drawingHover)) {
        const second=targetDraft??drawingHover;
        if (!positionTool(kind) || targetSide(kind,first.price,second.price))
          paint({kind,time1:first.time,price1:first.price,time2:second?.time,price2:second?.price,
            stopPrice:targetDraft && stopSide(kind,first.price,drawingHover?.price)?drawingHover.price:null},true,true);
      } else if (first) {
        const x=chart.timeScale().timeToCoordinate(first.time),y=series.candles.priceToCoordinate(first.price);
        if (finite(x)&&finite(y)) shape('circle',{cx:x,cy:y,r:4,fill:color});
      }
    }
    const hint=document.getElementById('drawing-hint'),zh=state.language==='zh-CN';
    hint.hidden=!state.drawingMode;
    hint.textContent=sameBarWarning==='time'?(zh?'请选择另一根 K 线':'Choose a different candle'):
      sameBarWarning==='price'?(zh?'请选择不同的价格':'Choose a different price'):
      sameBarWarning==='target'?(zh?'止盈价须在开仓价的盈利一侧':'Place the target on the profitable side of entry'):
      sameBarWarning==='stop'?(zh?'止损价须在开仓价的亏损一侧':'Place the stop on the losing side of entry'):
      positionTool(state.drawingMode)?(targetDraft?(zh?'选择止损价 · Esc 取消':'Choose stop · Esc cancel'):
        draft?(zh?'选择止盈价和结束时间 · Esc 取消':'Choose target and end time · Esc cancel'):
        (zh?'选择开仓价 · Esc 取消':'Choose entry · Esc cancel')):
      !twoAnchors(state.drawingMode)?(zh?'点击放置 · Esc 取消':'Click to place · Esc cancel'):
      draft?(zh?'选择终点 · Esc 取消':'Choose end · Esc cancel'):(zh?'选择起点 · Esc 取消':'Choose start · Esc cancel');
  }
  function drawingFields(drawing, fill=false) {
    const zh = state.language==='zh-CN', kind=drawing?.kind, position=positionTool(kind);
    const fields=[
      ['first',kind!=='VerticalLine',drawing?.price1,position?(zh?'开仓价':'Entry'):zh?(twoAnchors(kind)?'起点价格':'价格'):(twoAnchors(kind)?'Start price':'Price')],
      ['second',twoAnchors(kind),drawing?.price2,position?(zh?'止盈价':'Target'):(zh?'终点价格':'End price')],
      ['stop',position,drawing?.stopPrice,zh?'止损价':'Stop'],
      ['time1',timed(kind),drawing?.time1,zh?(twoAnchors(kind)?'起点时间':'时间'):(twoAnchors(kind)?'Start time':'Time')],
      ['time2',twoAnchors(kind)&&timed(kind),drawing?.time2,zh?'终点时间':'End time'],
    ].filter(([id])=>!!drawing);
    if (fill) for (const [id,visible,value,label] of fields) {
      const input=document.getElementById('drawing-'+id);
      document.getElementById('drawing-'+id+'-field').hidden=!visible;
      document.getElementById('drawing-'+id+'-label').textContent=label;
      if (visible && id.startsWith('time')) {
        const times=byTime.has(value)?state.rows.map(row=>row.time):[value,...state.rows.map(row=>row.time)];
        input.replaceChildren(...times.filter(finite).map(time=>new Option(eastern(time,true),String(time))));
      }
      input.value=value??'';
    }
    return fields.filter(([,visible])=>visible).map(([id])=>document.getElementById('drawing-'+id));
  }
  function editedAnchors(drawing, report=false) {
    const inputs=drawingFields(drawing);
    if(inputs.some(input=>input.value==='' || !(report?input.reportValidity():input.validity.valid)))return null;
    const prices = {first:'price1',second:'price2',stop:'stopPrice',time1:'time1',time2:'time2'};
    const values=Object.fromEntries(inputs.map(input=>[prices[input.id.slice(8)],Number(input.value)]));
    const edited={...drawing,...values};
    if (twoAnchors(edited.kind) && (timed(edited.kind) && edited.time1===edited.time2 || distinctPrices(edited.kind) && edited.price1===edited.price2))return null;
    if (positionTool(edited.kind) && (!targetSide(edited.kind,edited.price1,edited.price2) ||
        !stopSide(edited.kind,edited.price1,edited.stopPrice))) return null;
    return edited;
  }
  function selectDrawing(index,focus=false) {
    editorPreview=null;selectedDrawing=index; drawingRevision=state.drawingRevision||'';
    document.getElementById('drawing-error').textContent='';
    drawingPanel.hidden=index<0 || !!state.drawingMode;
    const zh=state.language==='zh-CN';
    const select=document.getElementById('drawing-select');select.replaceChildren();
    select.setAttribute('aria-label',zh?'已保存画线':'Saved drawings');
    state.drawings.forEach((d,i)=>select.append(new Option(toolName(d.kind)+' '+(i+1),i)));
    select.value=index;
    const inputs=drawingFields(state.drawings[index],true);
    document.getElementById('drawing-save').textContent=zh?'保存':'Save';document.getElementById('drawing-delete').textContent=zh?'删除':'Delete';
    document.getElementById('drawing-close').setAttribute('aria-label',zh?'收起画线编辑':'Close drawing editor');
    drawOverlay();if(focus){inputs[0]?.focus();inputs[0]?.select?.();}
  }
  function drawingHit(point){
    if(!point || point.y<0 || point.y>=chart.panes()[0].getHeight())return -1;
    let hit=-1,best=7;
    const width = chart.timeScale().width(), height = chart.panes()[0].getHeight();
    state.drawings.forEach((drawing,index)=>{
      for (const [a,b] of drawingGeometry(drawing,width,height)?.segments ?? []) {
        if (![a.x,a.y,b.x,b.y].every(finite)) continue;
        const dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        const distance=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
        if(distance<best){best=distance;hit=index;}
      }
    });
    return hit;
  }
  async function changeDrawing(remove){
    if(selectedDrawing<0 || drawingBusy)return;
    const drawing=state.drawings[selectedDrawing],edited=remove?drawing:editedAnchors(drawing,true);
    if(!edited) {
      document.getElementById('drawing-error').textContent=state.language==='zh-CN'
        ? '请检查价位顺序及两个时间锚点。' : 'Check the price order and the time anchors.';
      return;
    }
    drawingBusy=true;
    try {
      const response=await post({kind:remove?'drawing-delete':'drawing-edit',key:state.key,index:selectedDrawing,
        revision:drawingRevision,price1:edited.price1,price2:edited.price2,time1:edited.time1,time2:edited.time2,stopPrice:edited.stopPrice});
      if(!response.ok)throw new Error('Drawing request rejected');
      if(remove)selectDrawing(-1);
    } catch(e){error(e);}finally{drawingBusy=false;}
  }
  for(const id of ['drawing-first','drawing-second','drawing-stop','drawing-time1','drawing-time2'])document.getElementById(id).addEventListener('input',()=>{
    document.getElementById('drawing-error').textContent='';
    editorPreview=editedAnchors(state.drawings[selectedDrawing]);drawOverlay();
  });
  drawingPanel.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'){event.preventDefault();changeDrawing(false);}});
  document.getElementById('drawing-select').addEventListener('change',e=>selectDrawing(Number(e.target.value)));
  document.getElementById('drawing-save').addEventListener('click',()=>changeDrawing(false));
  document.getElementById('drawing-delete').addEventListener('click',()=>changeDrawing(true));
  document.getElementById('drawing-close').addEventListener('click',()=>{selectDrawing(-1);root.focus();});
  root.tabIndex=0;root.setAttribute('aria-label','Chart');
  let overlayFrame=0;
  function scheduleOverlay(){if(!overlayFrame)overlayFrame=requestAnimationFrame(()=>{overlayFrame=0;drawOverlay();});}
  root.addEventListener('pointermove',scheduleOverlay);root.addEventListener('wheel',scheduleOverlay,{passive:true});
  root.addEventListener('keydown',e=>{
    if(e.target!==root || state.drawingMode || !state.drawings.length)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selectDrawing((selectedDrawing+(e.key==='ArrowDown'?1:-1)+state.drawings.length)%state.drawings.length);}
    if(e.key==='Enter'&&selectedDrawing>=0){e.preventDefault();selectDrawing(selectedDrawing,true);}
  });
  root.addEventListener('mouseleave',()=>{drawingHover=null;drawOverlay();});
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(state?.drawingMode){const mode=state.drawingMode;state.drawingMode=null;draft=null;targetDraft=null;drawingHover=null;root.style.cursor='';chart.applyOptions({handleScroll:{pressedMouseMove:true},handleScale:{axisPressedMouseMove:true}});drawOverlay();post({kind:'drawing-cancel',key:state.key,mode,epoch:state.drawingEpoch}).catch(error);}
      selectDrawing(-1);
    }
    if((e.key==='Delete'||e.key==='Backspace') && selectedDrawing>=0 && e.target===root){e.preventDefault();changeDrawing(true);}
  });
  new ResizeObserver(()=>requestAnimationFrame(drawOverlay)).observe(root);
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
    addReadout(pane, title, row => row[field], color);
  }
  const eventNames = () => state.language === 'zh-CN'
    ? {news:'新闻',earnings:'财报',ex_dividend:'除息'}
    : {news:'News',earnings:'Earnings',ex_dividend:'Ex-dividend'};
  const eventStyle = type => ({news:{shape:'circle',color:state.theme.colors[0],icon:'News'},
    earnings:{shape:'square',color:state.theme.colors[2],icon:'CalendarClock'},
    ex_dividend:{shape:'arrowDown',color:state.theme.colors[1],icon:'Dividend'}}[type]);
  const hideEventTooltip = () => {document.getElementById('event-tooltip').hidden = true;};
  // Tooltip and click must resolve exactly the same filtered candle bucket.
  function eventHitItems(param) {
    const visible=(state.events||[]).filter(item=>filters.has(item.event.type)&&finite(item.time));
    const marker=visible.find(item=>item.event.id===param.hoveredObjectId);
    const time=marker?.time??param.time;
    return visible.filter(item=>item.time===time);
  }
  function showEventTooltip(param) {
    const items = eventHitItems(param);
    if (!param.point || state.drawingMode || !items.length) {hideEventTooltip();return;}
    const box = document.getElementById('event-tooltip'), names = eventNames(), zh = state.language === 'zh-CN';
    box.replaceChildren();
    const append = (parent,tag,value,css) => {const node=document.createElement(tag);node.textContent=value;if(css)node.className=css;parent.append(node);return node;};
    append(box,'div',zh ? `${items.length} 项事件` : `${items.length} event${items.length === 1 ? '' : 's'}`,'tooltip-heading');
    const limit=Math.max(1,Math.min(5,Math.floor((root.clientHeight-80)/150)));
    for (const item of items.slice(0,limit)) {
      const e=item.event, row=append(box,'div','','tooltip-event');
      const heading=append(row,'div',names[e.type],'tooltip-type');heading.prepend(meiliIcons.svg(eventStyle(e.type).icon,14),document.createTextNode(' '));heading.style.color=eventStyle(e.type).color;
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
      : (zh?'点击展开':'Click to expand'),'tooltip-meta');
    box.hidden=false;
    const width=box.offsetWidth, height=box.offsetHeight;
    box.style.left=Math.max(8,Math.min(param.point.x+16,root.clientWidth-width-8))+'px';
    box.style.top=Math.max(8,Math.min(param.point.y+16,root.clientHeight-height-8))+'px';
  }
  root.addEventListener('mouseleave',hideEventTooltip);
  root.addEventListener('wheel',hideEventTooltip,{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideEventTooltip();});
  // Pane primitive: paints in chart coordinates, below candles/indicators, and follows native zoom/pan/DPI.
  class SessionBackground {
    attached({chart,requestUpdate}) {this.chart=chart;this.requestUpdate=requestUpdate;}
    detached() {this.chart=null;this.requestUpdate=null;}
    paneViews() {return [{zOrder:()=> 'bottom',renderer:()=>({draw:target=>target.useBitmapCoordinateSpace(scope=>{
      if(!this.chart)return;
      const {context,horizontalPixelRatio,bitmapSize}=scope;
      for(const band of sessionBands){
        const scale=this.chart.timeScale(),start=scale.timeToCoordinate(state.rows[band.from].time),finish=scale.timeToCoordinate(state.rows[band.to].time);
        if(!finite(start)||!finite(finish))continue;
        const half=scale.options().barSpacing/2,left=start-half,right=finish+half;
        const x=Math.max(0,Math.round(left*horizontalPixelRatio)),end=Math.min(bitmapSize.width,Math.round(right*horizontalPixelRatio));
        if(end<=x)continue;
        context.fillStyle=band.session==='PreMarket'?state.theme.sessionPre:state.theme.sessionPost;
        context.fillRect(x,0,end-x,bitmapSize.height);
      }
    })})}];}
  }
  function updateSessions() {
    sessionBands=[];
    if(state.intraday)state.rows.forEach((row,index)=>{
      if(row.session!=='PreMarket'&&row.session!=='AfterHours')return;
      const previous=sessionBands.at(-1);
      if(previous?.session===row.session && previous.to===index-1)previous.to=index;
      else sessionBands.push({session:row.session,from:index,to:index});
    });
    for(const owner of chart.panes().map((pane,index)=>index===0?series.eventAnchor:pane.getSeries()[0]).filter(Boolean)){
      if(!sessionLayers.some(layer=>layer.owner===owner)){
        const primitive=new SessionBackground();owner.attachPrimitive(primitive);sessionLayers.push({owner,primitive});
      }
    }
    for(const layer of sessionLayers)layer.primitive.requestUpdate?.();
    const legend=document.getElementById('session-key');legend.replaceChildren();legend.hidden=!state.intraday||!state.rows.some(row=>row.session);
    const zh=state.language==='zh-CN';
    legend.title=zh?'按 K 线起始时间 · 美东标准时段：盘前 04:00–09:30，盘后 16:00–20:00；提前收市日未调整':'Bar start · Standard Eastern hours: pre-market 04:00–09:30, after-hours 16:00–20:00; early closes are not adjusted';
    const summary=document.createElement('summary');summary.setAttribute('aria-label',zh?'交易时段详情':'Trading session details');legend.append(summary);
    for(const [color,label] of [[state.theme.sessionPre,zh?'盘前':'Pre'],[state.theme.sessionPost,zh?'盘后':'Post']]){
      const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color;swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(label));summary.append(item);
    }
    summary.append(meiliIcons.svg('Info',14));
    const note=document.createElement('div');note.className='session-note';note.textContent=legend.title;legend.append(note);
  }
  function build() {
    if (chart) chart.remove();
    series = {}; priceLines = []; drawingSeries = [];sessionLayers=[];setupMarkers=null;paneReadouts=[];
    chart = LightweightCharts.createChart(root, {
      autoSize: true,
      layout: {fontFamily:getComputedStyle(document.body).fontFamily,fontSize:12 * (state.theme.textScale ?? 1),background: {type: 'solid', color: state.theme.background}, textColor: state.theme.text, attributionLogo: true, panes: {enableResize: true,separatorColor:state.theme.border,separatorHoverColor:state.theme.accent}},
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
      hoveredTime = row?.time;
      updateReadouts();
      showEventTooltip(param);
      drawingHover=drawingPoint(param);
      if(sameBarWarning==='time' && drawingHover && drawingHover.time!==draft?.time)sameBarWarning=false;
      root.style.cursor=state.drawingMode?'crosshair':(param.paneIndex===undefined||param.paneIndex===0)&&drawingHit(param.point)>=0?'pointer':'';
      drawOverlay();
    });
    chart.subscribeClick(param => {
      if (!state.drawingMode) {
        const drawing=param.paneIndex===undefined||param.paneIndex===0?drawingHit(param.point):-1;if(drawing>=0){if(drawing!==selectedDrawing)selectDrawing(drawing);root.focus();return;}
        if(selectedDrawing>=0)selectDrawing(-1);
        const hits=eventHitItems(param);
        hideEventTooltip();
        if (hits.length) {
          quoteVisible = false;
          selectedEventTime=hits[0].time;
          selectedEvent=hits.length===1?hits[0].event.id:null;
          renderEvents();
        }
        return;
      }
      // Drawing gestures use their own mouse lifecycle, including rapid second clicks.

    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {if (!applying && range) userRange = range;drawOverlay();});
  }
  // Group by original publication day in New York, never by an aligned candle or observation time.
  function eventDay(event) {
    if (!event.published) return event.date || '';
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(event.published));
    const value = type => parts.find(p => p.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function historyPosition() {
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
  const sidebarButtons = [...document.querySelectorAll('#right-tools button')];
  const eventPanel = document.getElementById('event-panel');
  const quotePanel = document.getElementById('quote-panel');
  const eventView = () => filters.size===3?'all':filters.size===1&&filters.has('news')?'news':filters.size===2&&!filters.has('news')?'calendar':null;
  function sidebarNames() {
    return state.language === 'zh-CN'
      ? {all:'动态',news:'新闻',calendar:'日历',quote:'行情'}
      : {all:'Activity',news:'News',calendar:'Calendar',quote:'Quote'};
  }
  function showSidebar() {
    const zh = state.language === 'zh-CN';
    const names = sidebarNames(), view = quoteVisible ? 'quote' : eventView();
    quotePanel.hidden = !quoteVisible;
    eventPanel.hidden = quoteVisible;
    document.getElementById('timeline').setAttribute('aria-label', zh ? '市场侧栏' : 'Market sidebar');
    document.getElementById('right-tools').setAttribute('aria-label', zh ? '侧栏视图' : 'Sidebar views');
    for (const button of sidebarButtons) {
      const name = names[button.dataset.view];
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
      button.setAttribute('aria-label', name);
      button.title = name;
      button.querySelector('span').textContent = name;
    }
    if (quoteVisible) renderQuote();
  }
  function renderQuote() {
    const zh = state.language === 'zh-CN', current = replayIndex === null && quote?.symbol === state.symbol ? quote : null;
    document.getElementById('quote-heading').textContent = sidebarNames().quote;
    const empty = document.getElementById('quote-empty');
    empty.textContent = replayIndex === null ? (zh?'暂无行情':'Quote unavailable') : (zh?'回放期间隐藏实时报价':'Live quotes are hidden during replay');
    empty.hidden = current !== null;
    document.getElementById('quote-body').hidden = current === null;
    if (!current) return;
    for (const field of ['symbol', 'name', 'price', 'change', 'source', 'time', 'extended']) {
      const node = document.getElementById('quote-' + field);
      node.textContent = current[field === 'time' ? 'timestamp' : field] || '';
    }
    document.getElementById('quote-change').className = current.direction === 'up' ? 'up' : current.direction === 'down' ? 'down' : '';
    document.getElementById('quote-extended').hidden = !current.extended;
    const labels = zh ? ['开盘','最高','最低','昨收','成交量'] : ['Open','High','Low','Previous close','Volume'];
    document.querySelectorAll('#quote-stats dd').forEach((item, index) => {
      item.previousElementSibling.textContent = labels[index];
      item.textContent = current[item.dataset.stat] || '—';
    });
  }
  async function refreshQuote() {
    if (!quoteVisible || quotePending || replayIndex !== null) return;
    quotePending = true;
    try {
      const response = await fetch('quote', {cache:'no-store'});
      const next = response.ok ? await response.json() : null;
      if (JSON.stringify(next) !== JSON.stringify(quote)) {
        quote = next;
        if (quoteVisible) renderQuote();
      }
    } catch {
      quote = null;
      if (quoteVisible) renderQuote();
    } finally {
      quotePending = false;
    }
  }
  setInterval(refreshQuote, 1000);
  for (const button of sidebarButtons) button.addEventListener('click', () => {
    if (!state) return;
    if (button.dataset.view === 'quote') {
      quoteVisible = true; showSidebar(); refreshQuote(); return;
    }
    quoteVisible = false;
    filters.clear();
    for(const type of button.dataset.view==='news'?['news']:button.dataset.view==='calendar'?['earnings','ex_dividend']:['news','earnings','ex_dividend'])filters.add(type);
    for(const input of document.querySelectorAll('#event-filters input'))input.checked=filters.has(input.dataset.type);
    selectedEvent=null;selectedEventTime=null;renderEvents();document.getElementById('event-list').scrollTop=0;
  });
  document.getElementById('event-group-clear').addEventListener('click',()=>{
    selectedEventTime=null;selectedEvent=null;renderEvents();document.getElementById('event-group-clear').blur();
    document.getElementById('event-heading').focus();
  });
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
    showSidebar();
    document.getElementById('event-heading').textContent=sidebarNames()[eventView()]||(zh?'筛选动态':'Filtered activity');
    document.getElementById('event-symbol').textContent=state.symbol;
    document.getElementById('event-heading').setAttribute('aria-label',zh?'事件与新闻':'Events and news');
    const box = document.getElementById('event-filters');
    if (box.dataset.language !== state.language) {
      box.dataset.language=state.language;box.replaceChildren();
      for (const type of Object.keys(names)) {
        const label = text('label',''), input=document.createElement('input');input.type='checkbox';input.checked=filters.has(type);input.dataset.type=type;
        input.addEventListener('change',()=>{input.checked?filters.add(type):filters.delete(type);renderEvents();});label.append(input);const glyph=text('span','');glyph.append(meiliIcons.svg(eventStyle(type).icon,12));glyph.style.color=eventStyle(type).color;glyph.setAttribute('aria-hidden','true');const tick=text('span','','filter-check');tick.append(meiliIcons.svg('Check',12));label.append(glyph,document.createTextNode(names[type]),tick);box.append(label);
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
    if(selectedEventTime!==null&&!visible.some(e=>e.time===selectedEventTime))selectedEventTime=null;
    const feed=selectedEventTime===null?visible:visible.filter(e=>e.time===selectedEventTime);
    const groupHeader=document.getElementById('event-group');groupHeader.hidden=selectedEventTime===null;
    const groupLabel=document.getElementById('event-group-label'),groupText=(zh?'所选 K 线':'Selected candle')+' · '+feed.length;
    if(groupLabel.textContent!==groupText)groupLabel.textContent=groupText;
    const clearGroup=document.getElementById('event-group-clear');clearGroup.title=zh?'返回全部事件':'Show all events';clearGroup.setAttribute('aria-label',clearGroup.title);
    if(!clearGroup.childElementCount)clearGroup.append(meiliIcons.svg('ArrowLeft',16));
    const groups=new Map();for(const item of visible) if(finite(item.time)){if(!groups.has(item.time))groups.set(item.time,[]);groups.get(item.time).push(item);}
    eventMarkers.setMarkers([...groups].sort((a,b)=>a[0]-b[0]).map(([time,items])=>{
      const types=[...new Set(items.map(i=>i.event.type))], selected=selectedEventTime===time||items.some(i=>i.event.id===selectedEvent);
      const style=eventStyle(items[0].event.type);
      return {time,id:items[0].event.id,position:'aboveBar',shape:style.shape,color:selected?state.theme.accent:style.color,
        size:selected?1.5:1,text:(selected?'› ':'')+types.map(type=>names[type]).join(' / ')+(items.length>1?' · '+items.length:'')};
    }));
    const focusedId=document.activeElement?.dataset.eventId;
    const list=document.getElementById('event-list'), nav=document.getElementById('event-history');
    const groupKey=selectedEventTime===null?'all':String(selectedEventTime);
    const scroll=list.dataset.key===state.key&&list.dataset.group===groupKey?list.scrollTop:0, focusedDay=document.activeElement?.dataset.day;
    list.dataset.key=state.key;list.dataset.group=groupKey;list.replaceChildren();nav.replaceChildren();
    nav.setAttribute('aria-label',zh?'历史日期导航':'History by date');
    const days=new Map();
    for(const item of feed){const day=eventDay(item.event);if(!days.has(day))days.set(day,[]);days.get(day).push(item);}
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
      const icon=text('span','','event-type-icon');icon.append(meiliIcons.svg(eventStyle(e.type).icon,16));icon.style.color=eventStyle(e.type).color;icon.setAttribute('aria-hidden','true');b.append(icon);
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
    if(!feed.length && state.timelineStatus!=='loading')list.append(text('p',zh?'暂无匹配事件':'No matching events','event-empty'));
    const detail=document.getElementById('event-detail');
    const changedDetail=detail.dataset.eventId!==(selectedEvent||'');
    const focusedDetail=!changedDetail&&detail.contains(document.activeElement)?document.activeElement.id:null;
    const keepMetadataOpen=detail.dataset.eventId===selectedEvent && detail.querySelector('details')?.open;
    detail.dataset.eventId=selectedEvent||'';detail.replaceChildren();detail.hidden=!selectedEvent;
    document.getElementById('event-content').classList.toggle('has-selection',!!selectedEvent);
    const item=visible.find(e=>e.event.id===selectedEvent);if(!item)return;
    const e=item.event;
    const close=text('button','','event-close');close.append(meiliIcons.svg('Close',18));close.setAttribute('aria-label',zh?'收起详情':'Close details');close.title=zh?'收起详情':'Close details';close.type='button';close.id='event-close';close.addEventListener('click',()=>{const id=selectedEvent;selectedEvent=null;renderEvents();list.querySelector('[data-event-id="'+id+'"]')?.focus({preventScroll:true});});
    detail.append(close,text('p',e.type==='news'?e.title:names[e.type],'event-detail-title'),text('p',date(e)+(e.type!=='news'?' · '+labels[e.confirmation]:''),'event-caption'));
    if(e.publisher||e.source)detail.append(text('p',e.publisher||e.source,'event-caption'));
    if(e.summary)detail.append(text('p',e.summary,'event-summary'));
    if(e.type==='news' && e.url){const b=text('button',zh?'原文':'Original','event-read');b.type='button';b.id='event-read';b.append(meiliIcons.svg('ExternalLink',14));b.addEventListener('click',()=>post({kind:'open-event',key:state.key,id:e.id}).catch(error));detail.append(b);}
    const metadata=document.createElement('details');metadata.className='event-metadata';metadata.open=!!keepMetadataOpen;
    metadata.append(text('summary',zh?'来源与时间':'Source & time'),text('p',labels[e.precision]+' · '+labels[e.confirmation]),text('p',(zh?'来源：':'Source: ')+(e.publisher?e.publisher+' / ':'')+e.source),text('p',labels[item.alignment]));
    if(e.published)metadata.append(text('p',(zh?'原始时间：':'Original time: ')+e.published));
    if(e.providerFetchedAt)metadata.append(text('p',(zh?'来源下载时间：':'Provider fetched: ')+e.providerFetchedAt));
    if(e.providerAsOf)metadata.append(text('p',(zh?'来源数据时间：':'Provider as of: ')+e.providerAsOf));
    metadata.append(text('p',(zh?'本次读取：':'Observed: ')+e.observedAt));detail.append(metadata);
    if(changedDetail)meiliMotion.enter(detail);
    if(focusedDetail)detail.querySelector('#'+focusedDetail)?.focus({preventScroll:true});
  }
  // Pane primitives draw with the chart and follow the plot bounds after a pane or sidebar resize.
  class PaneReadout {
    values = [];
    attached({requestUpdate}) { this.requestUpdate = requestUpdate; }
    detached() { this.requestUpdate = null; }
    setValues(values) {
      this.values = values;
      this.requestUpdate?.();
    }
    paneViews() {
      return [{zOrder:()=> 'top', renderer:()=>({draw: target => target.useMediaCoordinateSpace(({context,mediaSize}) => {
        if (!this.values.length) return;
        const {fontFamily,fontSize} = chart.options().layout;
        const lineHeight = Math.ceil(fontSize * 1.45);
        const inset = 8, padding = 4, gap = 9;
        const width = mediaSize.width - inset * 2 - padding * 2;
        const lines = Math.min(3, Math.floor((mediaSize.height - inset - padding * 2) / lineHeight));
        if (width <= 0 || lines < 1) return;

        context.font = fontSize + 'px ' + fontFamily;
        context.textBaseline = 'middle';
        let x = 0, line = 0;
        for (const {text,color} of this.values) {
          const length = context.measureText(text).width;
          if (x && x + length > width) { x = 0; line++; }
          if (line >= lines) break;
          const left = inset + x, top = inset + line * lineHeight;
          context.save();
          context.fillStyle = state.theme.background;
          context.globalAlpha = .9;
          context.fillRect(left, top, Math.min(length, width) + padding * 2, lineHeight);
          context.restore();
          context.fillStyle = color;
          context.fillText(text, left + padding, top + lineHeight / 2, width);
          x += length + gap + padding;
        }
      })})}];
    }
  }
  function addReadout(pane, label, value, color = state.theme.text) {
    (readoutFields[pane] ??= []).push({label,value,color});
  }
  function updateReadouts() {
    const hovered = byTime.get(hoveredTime), row = hovered ?? state.rows.at(-1);
    const index = row ? state.rows.indexOf(row) : -1;
    const zh = state.language === 'zh-CN';
    const names = zh ? {PreMarket:'盘前',Regular:'常规',AfterHours:'盘后',Closed:'休市'}
      : {PreMarket:'Pre-market',Regular:'Regular',AfterHours:'After-hours',Closed:'Closed'};
    const priceLabels = zh ? ['开','高','低','收'] : ['O','H','L','C'];
    const format = value => typeof value === 'string' ? value : finite(value) ? value.toFixed(2) : '—';
    chart.panes().forEach((pane, paneIndex) => {
      if (!paneReadouts[paneIndex]) {
        const primitive = new PaneReadout();
        pane.attachPrimitive(primitive);
        paneReadouts[paneIndex] = primitive;
      }
      const values = [];
      if (row && paneIndex === 0) {
        if (state.intraday && names[row.session]) values.push({text:names[row.session],color:state.theme.muted});
        ['open','high','low','close'].forEach((field,i) =>
          values.push({text:priceLabels[i] + ' ' + format(row[field]),color:state.theme.text}));
      }
      if (row) for (const {label,value,color} of readoutFields[paneIndex] ?? [])
        values.push({text:label + ' ' + format(value(row,index)),color});
      paneReadouts[paneIndex].setValues(values);
    });
  }
  function renderStudyStrip() {
    const strip = document.getElementById('study-strip'), studies = state.studies ?? [];
    const zh = state.language === 'zh-CN';
    strip.hidden = !studies.length;
    strip.setAttribute('aria-label', zh ? '图表指标' : 'Chart indicators');
    const signature = JSON.stringify(studies.map(({id,label,enabled,available,overlay}) => [id,label,enabled,available,overlay]));
    if (signature === studyStripSignature) return;
    studyStripSignature = signature;
    const active = document.activeElement?.dataset.study;
    const groups = [true, false].map(overlay => {
      const group = document.createElement('div');
      group.className = 'study-group';
      group.setAttribute('role','group');
      group.setAttribute('aria-label', overlay ? (zh?'主图指标':'Overlays') : (zh?'副图指标':'Indicator panes'));
      for (const study of studies.filter(item => item.overlay === overlay)) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.study = study.id;
        button.disabled = !study.available; button.textContent = study.label;
        button.setAttribute('aria-pressed', String(study.enabled));
        button.title = study.id === 'iv'
          ? (zh?'日 K · 使用本地记录的 IV 历史':'Daily candles · locally recorded IV history')
          : study.available ? study.label : (zh?'仅适用于分时周期':'Intraday intervals only');
        button.addEventListener('click', async () => {
          if (studyPending) return;
          studyPending = true;
          try { await post({kind:'toggle-study', key:state.key, id:study.id}); }
          finally { studyPending = false; }
        });
        group.append(button);
      }
      return group;
    });
    strip.replaceChildren(...groups);
    if (active) [...strip.querySelectorAll('button')].find(button => button.dataset.study === active)?.focus({preventScroll:true});
  }
  function renderExtraStudies(lastPane) {
    const theme = state.theme;
    const markerData = [];
    for (const [studyIndex, study] of (state.studies ?? []).entries()) {
      if (!study.enabled) continue;
      if (!study.lines.length) {
        if (study.id === 'iv')
          addReadout(0, 'IV', () => state.language === 'zh-CN' ? '暂无本地样本' : 'No recorded samples', theme.muted);
        continue;
      }
      const pane = study.overlay ? 0 : ++lastPane;
      study.lines.forEach((line, index) => {
        if (line.style === 'counts') {
          state.rows.forEach((row, i) => {
            const count = line.values[i];
            if (finite(count)) markerData.push({time:row.time,position:count > 0?'aboveBar':'belowBar',
              shape:'circle',size:0,text:String(Math.abs(count)),color:count > 0?theme.up:theme.down});
          });
          return;
        }
        const id = 'study-' + study.id + '-' + index;
        const color = theme.colors[(studyIndex + index + 1) % theme.colors.length];
        const histogram = line.style === 'volume';
        const type = histogram ? LightweightCharts.HistogramSeries : LightweightCharts.LineSeries;
        const dots = line.style === 'dots';
        if (!series[id]) series[id] = chart.addSeries(type, {
          priceLineVisible:false,lastValueVisible:false,lineVisible:!dots,pointMarkersVisible:dots,
          pointMarkersRadius:2,lineWidth:1, ...(histogram ? {priceFormat:{type:'volume'}} : {})
        },pane);
        series[id].applyOptions({color,title:line.label});
        addReadout(pane, line.label, (_, i) => line.values[i], color);
        series[id].setData(state.rows.map((row, i) => finite(line.values[i]) ? {time:row.time,value:line.values[i],
          ...(histogram ? {color:row.close >= (row.open ?? state.rows[i-1]?.close ?? row.close) ? theme.up : theme.down} : {})
        } : {time:row.time}));
      });
    }
    if (markerData.length && !setupMarkers) setupMarkers = LightweightCharts.createSeriesMarkers(series.eventAnchor, []);
    setupMarkers?.setMarkers(markerData);
  }
  function applyDisplay() {
    if (!chart) return;
    const style = styleSelect.value;
    series.candles.applyOptions({visible:style==='candles'});
    series.incomplete.applyOptions({visible:style==='candles'||style==='bars'});
    for (const [id, value] of [['closeLine','line'], ['closeArea','area'], ['ohlc','bars']])
      series[id]?.applyOptions({visible:style===value});
    const modes = {percent:LightweightCharts.PriceScaleMode.Percentage, log:LightweightCharts.PriceScaleMode.Logarithmic};
    chart.priceScale('right', 0).applyOptions({mode:modes[scaleSelect.value] ?? LightweightCharts.PriceScaleMode.Normal});
  }
  function renderDisplay() {
    const zh = state.language === 'zh-CN';
    displayMenu.hidden = !state.studies;
    document.getElementById('display-label').textContent = replayIndex !== null ? (zh?'显示 · 回放':'Display · Replay') : (zh?'显示':'Display');
    document.getElementById('chart-style-label').textContent = zh ? '图形' : 'Chart type';
    document.getElementById('chart-scale-label').textContent = zh ? '坐标' : 'Scale';
    const setOptions = (select, labels) => [...select.options].forEach((option, i) => option.textContent = labels[i]);
    setOptions(styleSelect, zh ? ['K 线','收盘线','面积图','OHLC 条形'] : ['Candles','Close line','Area','OHLC bars']);
    setOptions(scaleSelect, zh ? ['价格','百分比','对数'] : ['Price','Percent','Logarithmic']);
    const focus = document.getElementById('chart-focus');
    focus.textContent = focusChart ? (zh?'显示右栏':'Show sidebar') : (zh?'专注图表':'Focus chart');
    focus.setAttribute('aria-pressed',String(focusChart));
    document.getElementById('chart-image').textContent = zh ? '保存图像' : 'Save image';
    const controls = document.getElementById('replay-controls');
    const toggle = document.getElementById('replay-toggle');
    toggle.disabled = !liveState?.rows.length;
    toggle.textContent = replayIndex === null ? (zh?'开始回放':'Start replay') : (zh?'退出回放':'Exit replay');
    controls.hidden = replayIndex === null;
    if (replayIndex !== null) {
      const slider = document.getElementById('replay-position');
      slider.max = liveState.rows.length - 1;
      slider.value = replayIndex;
      document.getElementById('replay-position-label').textContent = eastern(replayTime,true);
      document.getElementById('replay-speed-label').textContent = zh?'速度':'Speed';
      document.getElementById('replay-play').textContent = replayTimer ? (zh?'暂停':'Pause') : (zh?'播放':'Play');
      document.getElementById('replay-step').textContent = zh?'下一根':'Next bar';
    }
  }
  for (const select of [styleSelect, scaleSelect]) select.addEventListener('change',applyDisplay);
  document.getElementById('chart-focus').addEventListener('click', () => {
    focusChart = !focusChart;
    document.body.classList.toggle('chart-focus',focusChart);
    renderDisplay();
  });
  document.getElementById('chart-image').addEventListener('click', () => {
    if (!chart || !state.rows.length) return;
    const link = document.createElement('a');
    link.href = chart.takeScreenshot().toDataURL('image/png');
    link.download = state.symbol.replace(/[^a-z0-9._-]/gi,'_') + '-chart.png';
    link.click();
  });

  function render(next) {
    if (!liveState && preferredSidebarWidth === null && Number.isInteger(next.sidebarWidth))
      preferredSidebarWidth = next.sidebarWidth;
    applySidebarWidth();
    if (replayIndex !== null && (liveState.key !== next.key || next.drawingMode)) stopReplay();
    liveState = next;
    if (replayIndex !== null) {
      const index = next.rows.findIndex(row => row.time >= replayTime);
      if (index >= 0 && next.rows[index].time === replayTime) {
        replayIndex = index;
        renderReplay();
        return;
      }
      stopReplay();
    }
    renderFrame(next);
  }
  function renderReplay() {
    const length = replayIndex + 1;
    const studies = (liveState.studies ?? []).map(study => ({
      ...study, lines:study.lines.map(line => {
        const values = line.values.slice(0,length);
        if (line.label === 'Chikou') values.fill(null,Math.max(0,length-26));
        return {...line,values};
      })
    }));
    // Only observations that existed at the playhead can be drawn or selected.
    renderFrame({...liveState, rows:liveState.rows.slice(0,length), studies,
      drawingMode:null,drawingStart:null,drawingTarget:null,drawings:[],preserveView:false,
      events:(liveState.events ?? []).filter(item => finite(item.time) && item.time <= replayTime),
      compare:liveState.compare.filter(point => point.time <= replayTime)});
  }
  function seekReplay(index) {
    replayIndex = index;
    replayTime = liveState.rows[index].time;
    renderReplay();
  }
  function stopReplay() {
    clearInterval(replayTimer);
    replayIndex = replayTime = replayTimer = null;
  }
  function stepReplay() {
    if (replayIndex + 1 >= liveState.rows.length) {
      clearInterval(replayTimer);
      replayTimer = null;
      renderDisplay();
      return;
    }
    seekReplay(replayIndex + 1);
  }
  function playReplay() {
    const playing = replayTimer !== null;
    clearInterval(replayTimer);
    replayTimer = playing ? null : setInterval(stepReplay,1000 / Number(document.getElementById('replay-speed').value));
    renderDisplay();
  }
  document.getElementById('replay-toggle').addEventListener('click', () => {
    if (replayIndex !== null) { stopReplay(); render(liveState); }
    else if (liveState.rows.length) seekReplay(Math.max(0,liveState.rows.length-31));
  });
  document.getElementById('replay-position').addEventListener('input',e=>seekReplay(Number(e.target.value)));
  document.getElementById('replay-step').addEventListener('click',stepReplay);
  document.getElementById('replay-play').addEventListener('click',playReplay);
  document.getElementById('replay-speed').addEventListener('change',() => {
    if (replayTimer !== null) {
      clearInterval(replayTimer);
      replayTimer = null;
      playReplay();
    }
  });

  function renderFrame(next) {
    const previousKey = key, saved = userRange, previousMode=state?.drawingMode, previousRevision=state?.drawingRevision,previousEpoch=state?.drawingEpoch;
    state = next;
    readoutFields = [];
    if (previousKey !== state.key) hoveredTime = undefined;
    if(previousKey!==state.key || previousMode!==state.drawingMode || previousEpoch!==state.drawingEpoch){finishingDrawing=false;sameBarWarning=false;draft=null;targetDraft=null;drawingHover=null;selectedDrawing=-1;}
    if(state.drawingStart)draft=state.drawingStart;
    if(state.drawingTarget)targetDraft=state.drawingTarget;
    if(previousRevision && previousRevision!==state.drawingRevision)selectedDrawing=-1;
    byTime = new Map(state.rows.map(r => [r.time, r]));
    document.documentElement.lang = state.language;
    const textScale = state.theme.textScale ?? 1;
    document.documentElement.style.setProperty('--text-scale', textScale);
    const shape = JSON.stringify([state.show, (state.studies ?? []).filter(study => study.enabled).map(study => [study.id, study.lines.length])]);
    const rebuild = !chart || signature !== shape;
    applying = true;
    try {
      if (rebuild) {signature = shape; build();}
      key = state.key;
      if (previousKey !== key) {selectedEvent = null;selectedEventTime=null;}
      const t = state.theme, c = t.colors;
      document.body.style.background = t.background; document.body.style.color = t.text;
      document.documentElement.dataset.reducedMotion=String(state.theme.reducedMotion===true);document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
      for (const [name,value] of Object.entries({brand:t.brand,focus:t.focus,link:t.link,input:t.input,hover:t.hover,pressed:t.pressed,danger:t.danger,background:t.background,text:t.text,muted:t.muted,control:t.control,border:t.border,accent:t.accent,'quote-up':t.up,'quote-down':t.down,'error-background':t.errorBackground,'error-text':t.errorText}))
        if (value) document.documentElement.style.setProperty('--'+name,value);
      document.getElementById('symbol').textContent = state.symbol;
      const resizeLabel = state.language === 'zh-CN' ? '调整右侧栏宽度' : 'Resize right sidebar';
      sidebarSplitter.setAttribute('aria-label',resizeLabel);
      sidebarSplitter.title = resizeLabel;
      document.getElementById('fit').textContent = state.language === 'zh-CN' ? '适应' : 'Fit';
      document.getElementById('fit').setAttribute('aria-label',state.language === 'zh-CN' ? '适应图表窗口' : 'Fit chart to window');
      document.getElementById('help-heading').textContent=state.language === 'zh-CN' ? '操作' : 'Controls';
      document.getElementById('help-heading').prepend(meiliIcons.svg('Help',14));
      document.getElementById('hint').textContent = state.language === 'zh-CN' ? '滚轮缩放 · 拖动平移 · 点击画线编辑 · 方向键选择画线，Enter 编辑，Delete 删除'  : 'Scroll to zoom · Drag to pan · Click lines to edit · Arrow keys select, Enter edits, Delete removes' ;
      document.getElementById('empty').textContent = state.rows.length ? '' : state.labels.empty;
      document.getElementById('error').style.display = 'none';
      chart.applyOptions({layout: {fontSize: 12 * textScale, background: {type: 'solid', color: t.background}, textColor: t.text,panes:{separatorColor:t.border,separatorHoverColor:t.accent}}, crosshair:{vertLine:{color:t.muted,labelBackgroundColor:t.accent},horzLine:{color:t.muted,labelBackgroundColor:t.accent}}, grid: {vertLines: {color: t.grid}, horzLines: {color: t.grid}}, localization: {locale: state.language}, timeScale: {timeVisible: state.intraday}});
      series.candles.applyOptions({upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down, borderUpColor: t.up, borderDownColor: t.down});
      series.candles.setData(state.rows.map(r => !r.incomplete && [r.open,r.high,r.low,r.close].every(finite) ? {time:r.time,open:r.open,high:r.high,low:r.low,close:r.close} : {time:r.time}));
      series.incomplete.applyOptions({color:t.muted,lineVisible:state.rows.length > 0 && state.rows.every(r=>r.incomplete),pointMarkersVisible:!state.rows.every(r=>r.incomplete)});
      series.incomplete.setData(state.rows.map(r => r.incomplete ? point(r, 'close') : {time: r.time}));
      series.eventAnchor.setData(state.rows.map(r => point(r, finite(r.high) ? 'high' : 'close')));
      renderEvents();
      renderStudyStrip();
      renderDisplay();
      renderDrawingMenu();
      if (state.studies) {
        if (!series.closeLine) series.closeLine = chart.addSeries(LightweightCharts.LineSeries, {lineWidth:2});
        series.closeLine.applyOptions({color:c[0]});
        const close = state.rows.map(row => point(row,'close'));
        series.closeLine.setData(close);
        if (!series.closeArea) series.closeArea = chart.addSeries(LightweightCharts.AreaSeries, {lineWidth:2});
        series.closeArea.applyOptions({lineColor:c[0],topColor:c[0]+'50',bottomColor:c[0]+'08'});
        series.closeArea.setData(close);
        if (!series.ohlc) series.ohlc = chart.addSeries(LightweightCharts.BarSeries, {openVisible:true});
        series.ohlc.applyOptions({upColor:t.up,downColor:t.down});
        series.ohlc.setData(series.candles.data());
        applyDisplay();
      }
      if (state.show.ma) line('ma', 'ma', state.labels.ma, c[0]);
      if (state.show.ema) line('ema', 'ema', state.labels.ema, c[1]);
      if (state.show.boll) {line('bollMiddle','bollMiddle',state.labels.boll,c[2]);line('bollUpper','bollUpper','BOLL ↑',c[2]);line('bollLower','bollLower','BOLL ↓',c[2]);}
      let pane = 0;
      if (state.show.volume) {
        pane++;
        if (!series.volume) series.volume = chart.addSeries(LightweightCharts.HistogramSeries, {title: state.labels.volume, priceFormat: {type: 'volume'}, lastValueVisible: false, priceLineVisible: false}, pane);
        series.volume.applyOptions({title:state.labels.volume});
        addReadout(pane, state.labels.volume, row => row.volume);
        series.volume.setData(state.rows.map((r,i) => point(r, 'volume', r.close >= (finite(r.open) ? r.open : state.rows[i-1]?.close ?? r.close) ? t.up : t.down)));
      }
      if (state.show.macd) {
        pane++;
        if (!series.histogram) series.histogram = chart.addSeries(LightweightCharts.HistogramSeries, {title: 'MACD H', priceLineVisible: false, lastValueVisible: false}, pane);
        series.histogram.setData(state.rows.map(r => point(r, 'histogram', r.histogram >= 0 ? t.up : t.down)));
        addReadout(pane, 'MACD H', row => row.histogram);
        line('macd','macd',state.labels.macd,c[0],pane);line('signal','signal','Signal',c[1],pane);
      }
      if (state.show.rsi) {
        pane++;line('rsi','rsi',state.labels.rsi,c[2],pane,{autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});
        if (rebuild) for (const price of [30,70]) series.rsi.createPriceLine({price, color:t.muted, lineWidth:1, lineStyle:2, axisLabelVisible:false});
      }
      if (state.show.kdj) {pane++;line('k','k','K',c[0],pane);line('d','d','D',c[1],pane);line('j','j',state.labels.kdj,c[2],pane);}
      renderExtraStudies(pane);
      if (!series.compare) series.compare = chart.addSeries(LightweightCharts.LineSeries, {color:c[3], lineWidth:2, priceLineVisible:false, lastValueVisible:false});
      series.compare.applyOptions({color:c[3],title:state.compareLabel});
      series.compare.setData(state.compare.map(p => finite(p.value) ? p : {time:p.time}));
      for (const l of priceLines) series.candles.removePriceLine(l);
      for (const s of drawingSeries) chart.removeSeries(s);
      priceLines = [];drawingSeries = [];
      for (const d of state.drawings) {
        if (d.kind === 'HorizontalLine') priceLines.push(series.candles.createPriceLine({price:d.price1,color:c[4],lineWidth:1,lineStyle:2,axisLabelVisible:true}));
        else if (d.kind === 'TrendLine' && finite(d.time1) && finite(d.time2) && d.time1 !== d.time2) {
          const s = chart.addSeries(LightweightCharts.LineSeries,{color:c[4],lineWidth:2,priceLineVisible:false,lastValueVisible:false});
          s.setData([{time:d.time1,value:d.price1},{time:d.time2,value:d.price2}].sort((a,b)=>a.time-b.time));drawingSeries.push(s);
        }
      }
      updateSessions();
      root.style.cursor=state.drawingMode?'crosshair':'';
      chart.applyOptions({handleScroll:{pressedMouseMove:!state.drawingMode},handleScale:{axisPressedMouseMove:!state.drawingMode}});
      if(document.activeElement?.closest('#drawing-panel') && !drawingPanel.hidden && previousRevision===state.drawingRevision)drawOverlay();else selectDrawing(selectedDrawing);
      if (rebuild) {
        const panes = chart.panes();
        // Relative weights remain stable when autoSize lays out the window after the first frame.
        panes.forEach((p,i) => p.setStretchFactor(i === 0 ? Math.max(4, (panes.length - 1) * 1.5) : 1));
      }
      if (saved && previousKey === key && state.preserveView) {chart.timeScale().setVisibleLogicalRange(saved);userRange = saved;}
      else {chart.timeScale().fitContent();userRange = null;}
      updateReadouts();
      document.title = 'EasySellPut Charts · ' + state.symbol;
      diagnostic({status:'rendered',drawingPreview:!!draft,drawingHandles:overlay.querySelectorAll("circle").length,drawingSelection:selectedDrawing,sidebarPermanent:document.getElementById('timeline').tagName==='ASIDE',sidebarViews:document.querySelectorAll('#right-tools button').length,sessionBands:sessionBands.length,sessionPanes:sessionLayers.length,historyGroups:document.querySelectorAll('.event-day').length,historyStops:document.getElementById('event-history').children.length,events:(state.events||[]).length,eventMarkers:eventMarkers.markers().length,key:state.key,rows:state.rows.length,candles:series.candles.data().filter(p=>finite(p.open)).length,panes:chart.panes().length,lastMa:series.ma?.data().at(-1)?.value ?? null,background:t.background,up:series.candles.options().upColor,range:chart.timeScale().getVisibleLogicalRange()});
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
  window.meiliChart = {inspect:()=>({chart,series,state,eventMarkers,sessionBands,sessionLayers,paneReadouts}),render};
  poll();
})();
