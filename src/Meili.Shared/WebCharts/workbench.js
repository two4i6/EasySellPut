/* Trusted local presentation. Quotes, premiums, Greeks and P/L are selected/calculated in .NET only. */
'use strict';
(() => {
  const $ = id => document.getElementById(id), finite = Number.isFinite;
  let state, version=-1, chainSignature='', legSignature='', page=0, pending=false, pendingTimer, hover=null, domain=null, viewport=null, drag=null, rightMode='Call',initialSideResolved=false,centeredViewKey=null;
  const formatters=new Map();
  function formatter(digits=2,type='decimal'){const key=state?.language+':'+digits+':'+type;if(!formatters.has(key))formatters.set(key,new Intl.NumberFormat(state?.language||'en-US',{style:type,maximumFractionDigits:digits,minimumFractionDigits:digits}));return formatters.get(key);}
  const text=(id,value)=>{$(id).textContent=value??'';};
  const label=k=>state?.labels[k]??k;
  const number=(value,digits=2)=>finite(value)?formatter(digits).format(value):'—';
  const diagnostic=body=>fetch('event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'diagnostic',...body})}).catch(()=>{});
  function message(value){text('message',value);$('message').style.display=value?'block':'none';}
  function lock(value){document.body.setAttribute('aria-busy',String(value));pending=value;document.querySelectorAll('[data-mutation]').forEach(e=>e.disabled=value||state?.busy||e.dataset.unavailable==='true');}
  async function send(body){
    if(pending||!state||state.busy)return;
    lock(true);clearTimeout(pendingTimer);
    pendingTimer=setTimeout(()=>{lock(false);message(label('Unavailable'));},6000);
    try{const response=await fetch('event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,key:state.key})});if(!response.ok)throw new Error('Event HTTP '+response.status);}
    catch(e){clearTimeout(pendingTimer);lock(false);message(label('Unavailable'));diagnostic({status:'error',message:String(e).slice(0,250)});}
  }
  function element(tag,value,cls){const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;return e;}
  function button(value,action,disabled=false){const e=element('button',value);e.type='button';e.dataset.mutation='true';e.dataset.unavailable=String(disabled);e.disabled=disabled||pending||state.busy;e.addEventListener('click',action);return e;}
  function cell(row,value,cls){const e=element('td',value,cls);row.append(e);return e;}
  function headers(id,values){const row=element('tr');for(const value of values)row.append(element('th',value));$(id).querySelector('thead').replaceChildren(row);}
  const formats={Be:['be',2],BePercent:['bePercent',2,'percent'],Oi:['oi',0],Volume:['volume',0],Iv:['iv',1,'percent'],Delta:['delta',3],Gamma:['gamma',4],Theta:['theta',3],Vega:['vega',3],Rho:['rho',3],Last:['last',2]};
  const columnLabel=id=>label(({Last:'LastPrice',Oi:'OiShort',Iv:'IvShort'})[id]??id);
  const sameColumns=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  let desiredColumns=null,columnsRequest=null,columnsTimer,columnsDeadline;
  const visibleColumns=()=>desiredColumns??state.columns;
  function chooseColumns(columns){
    desiredColumns=state.columnOptions.filter(id=>columns.includes(id));renderColumnPicker();renderChain(true);
    clearTimeout(columnsTimer);if(!columnsRequest)saveColumns();
  }
  async function saveColumns(){
    if(columnsRequest||!desiredColumns)return;
    if(sameColumns(desiredColumns,state.columns)){desiredColumns=null;return;}
    const request={columns:[...desiredColumns],revision:state.columnsRevision};columnsRequest=request;
    function failed(){if(columnsRequest!==request)return;columnsRequest=null;desiredColumns=null;renderColumnPicker();renderChain(true);message(label('Unavailable'));}
    clearTimeout(columnsDeadline);columnsDeadline=setTimeout(failed,6000);
    try{const response=await fetch('event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'set-columns',key:state.key,columns:request.columns})});if(!response.ok)throw new Error('Columns HTTP '+response.status);}
    catch{clearTimeout(columnsDeadline);failed();}
  }
  function acceptColumns(){
    if(!columnsRequest||state.columnsRevision<=columnsRequest.revision)return;
    clearTimeout(columnsDeadline);columnsRequest=null;
    if(state.columnsError||sameColumns(desiredColumns,state.columns))desiredColumns=null;
    if(desiredColumns){clearTimeout(columnsTimer);columnsTimer=setTimeout(saveColumns,0);}
  }
  function renderColumnPicker(){
    text('columnHeading',label('Columns'));text('columnsLabel',label('Columns'));$('columnsTrigger').title=label('Columns');
    if(!$('columnsIcon').firstChild)$('columnsIcon').append(meiliIcons.svg('Settings',20));
    text('columnsFixed',label('ColumnsFixed'));$('columnsFixed').title=label('BeHint');
    for(const [id,key,columns]of [['columnsCompact','Compact',[]],['columnsCommon','Common',state.defaultColumns],['columnsAll','Everything',state.columnOptions]]){
      const b=$(id);b.textContent=label(key);b.onclick=()=>chooseColumns(columns);b.setAttribute('aria-pressed',String(sameColumns(visibleColumns(),columns)));
    }
    const container=$('columnOptions');
    for(const id of state.columnOptions){
      let row=[...container.children].find(e=>e.dataset.column===id);
      if(!row){row=element('label');row.dataset.column=id;const input=element('input');input.type='checkbox';input.value=id;input.addEventListener('change',()=>chooseColumns(state.columnOptions.filter(c=>c===id?input.checked:visibleColumns().includes(c))));row.append(input,element('span'));container.append(row);}
      row.querySelector('input').checked=visibleColumns().includes(id);row.querySelector('span').textContent=id==='Last'?label('LastPrice'):label(id);row.title=id==='Be'||id==='BePercent'?label('BeHint'):['Iv','Delta','Gamma','Theta','Vega','Rho'].includes(id)?label('ModelHint'):label('SourceHint');
    }
  }
  function metricText(c,id){
    if(!c)return '—';const [field,digits,type]=formats[id],value=c[field];
    if(!finite(value))return '—';
    return type==='percent'?formatter(digits,'percent').format(value):number(value,digits);
  }
  function renderChain(force=false){
    const signature=JSON.stringify([state.symbol,state.expiration,state.spot,state.contractRevision,visibleColumns(),state.legs.map(l=>[l.id,l.type,l.side,l.strike,l.expiration]),state.language,state.busy,$('search').value,rightMode,$('near').checked,page]);
    if(!force&&chainSignature===signature)return;chainSignature=signature;
    const query=$('search').value.trim().toLowerCase(),right=rightMode,optional=visibleColumns().filter(id=>formats[id]);
    const source=state.contracts.filter(c=>(right==='All'||c.right===right)&&finite(c.strike)&&c.strike>0&&['Call','Put'].includes(c.right));
    $('startSelecting').disabled=state.busy||!source.some(c=>c.canSelect&&(finite(c.askReference?.price)||finite(c.bidReference?.price)));
    const sourceStrikes=[...new Set(source.map(c=>c.strike))];
    const nearest=sourceStrikes.length&&finite(state.spot)?sourceStrikes.reduce((a,b)=>Math.abs(a-state.spot)<Math.abs(b-state.spot)?a:b):null;
    const viewKey=JSON.stringify([state.symbol,state.expiration,right,$('near').checked,query]),shouldCenter=!state.busy&&viewKey!==centeredViewKey;
    let contracts=source.filter(c=>!query||String(c.strike).includes(query)||c.id.toLowerCase().includes(query));
    if($('near').checked&&finite(state.spot)){const nearest=[...new Set(contracts.map(c=>c.strike))].sort((a,b)=>Math.abs(a-state.spot)-Math.abs(b-state.spot)).slice(0,21);contracts=contracts.filter(c=>nearest.includes(c.strike));}
    const groups=new Map();for(const c of contracts){if(!groups.has(c.strike))groups.set(c.strike,{});groups.get(c.strike)[c.right]=c;}
    const strikes=[...groups.keys()].sort((a,b)=>b-a),pages=Math.max(1,Math.ceil(strikes.length/100));if(shouldCenter&&strikes.includes(nearest))page=Math.floor(strikes.indexOf(nearest)/100);page=Math.min(page,pages-1);
    const both=right==='All',callColumns=[...optional,'bid','ask'],putColumns=['bid','ask',...optional.slice().reverse()];
    const sides=both?[['Call',callColumns],['Put',putColumns]]:[[right,callColumns]];
    const table=$('chain');table.dataset.right=right;
    const top=element('tr'),bottom=element('tr'),colgroup=element('colgroup');
    const strikeHead=()=>{const th=element('th',label('Strike')+' ↓','strike');th.rowSpan=both?2:1;th.scope='col';th.dataset.field='strike';top.append(th);const col=element('col');col.dataset.baseWidth='80';col.dataset.fixed='true';colgroup.append(col);};
    if(!both)strikeHead();
    let totalWidth=80,totalColumns=1;
    for(const [kind,columns]of sides){
      if(both&&kind==='Put')strikeHead();
      if(both){const group=element('th',label(kind),'group-label');group.colSpan=columns.length;group.scope='colgroup';top.append(group);}
      for(const id of columns){
        const action=id==='bid'||id==='ask',title=action?label(id==='bid'?'Bid':'Ask')+' · '+label(id==='bid'?'Sell':'Buy'):columnLabel(id);
        const th=element('th',title);th.scope='col';th.dataset.field=id;th.dataset.right=kind;
        if(id==='Be'||id==='BePercent')th.title=label('BeHint');
        else if(['Iv','Delta','Gamma','Theta','Vega','Rho'].includes(id))th.title=label('ModelHint');
        (both?bottom:top).append(th);const col=element('col');col.dataset.baseWidth=String(action?96:88);colgroup.append(col);totalWidth+=action?96:88;totalColumns++;
      }
    }
    table.querySelector('colgroup')?.remove();table.insertBefore(colgroup,table.querySelector('thead'));table.style.minWidth=totalWidth+'px';table.querySelector('thead').replaceChildren(...(both?[top,bottom]:[top]));
    const focused=document.activeElement?.dataset.contract?{id:document.activeElement.dataset.contract,side:document.activeElement.dataset.quoteSide}:null;
    const body=document.createDocumentFragment(),visible=strikes.slice(page*100,page*100+100);
    let spotInserted=false;
    function appendSpot(){const spot=element('tr',undefined,'spot-row');const td=cell(spot);td.colSpan=totalColumns;td.title=state.headline;td.append(element('span',number(state.spot),'spot-value'));body.append(spot);spotInserted=true;}

    for(const strike of visible){
      const row=element('tr');row.dataset.strike=strike;if(strike===nearest)row.className='atm';
      const addStrike=()=>{const td=cell(row,number(strike),'strike');td.dataset.field='strike';td.title=label('Strike');};
      if(!both)addStrike();
      for(const [kind,columns]of sides){
        if(both&&kind==='Put')addStrike();
        const c=groups.get(strike)[kind];
        for(const id of columns){
          const action=id==='bid'||id==='ask',td=cell(row,undefined,action?'quote-cell':'metric-cell');td.dataset.field=id;td.dataset.right=kind;
          if(!action){td.textContent=metricText(c,id);td.title=[label(id),id==='Be'||id==='BePercent'?label('BeHint'):['Iv','Delta','Gamma','Theta','Vega','Rho'].includes(id)?label('ModelHint'):label('SourceHint'),state.source,state.asOf].filter(Boolean).join(' · ');continue;}
          if(!c){td.textContent='—';continue;}
          const quoteSide=id,side=id==='bid'?'Short':'Long',key=id==='bid'?'Sell':'Buy',ref=quoteSide==='bid'?c.bidReference:c.askReference,quote=ref?.price;
          const disabled=!c.canSelect||!finite(quote)||quote<=0||state.busy;
          const chip=button(number(quote),()=>send({kind:'toggle-contract',contract:c.id,side,quantity:1,quoteSide}),disabled);
          chip.className='quote-chip '+(side==='Long'?'buy':'sell');chip.dataset.contract=c.id;chip.dataset.quoteSide=quoteSide;
          chip.title=[label(key),label(kind),number(strike),label(quoteSide==='bid'?'Bid':'Ask'),label('Draft')].join(' · ');
          chip.setAttribute('aria-label',`${label(key)} ${label(kind)} ${number(strike)} · ${number(quote)}`);
          chip.setAttribute('aria-pressed',String(state.legs.some(l=>l.type===kind&&Number(l.strike)===strike&&l.expiration===c.expiration&&l.side===side)));
          td.append(chip);
        }
      }
      if(!spotInserted&&visible.includes(nearest)&&strike<state.spot)appendSpot();
      body.append(row);
    }
    if(!spotInserted&&visible.includes(nearest))appendSpot();
    table.querySelector('tbody').replaceChildren(body);positionStrike();
    if(shouldCenter&&sourceStrikes.length){centeredViewKey=viewKey;requestAnimationFrame(()=>{if(centeredViewKey===viewKey)centerAtm(true);});}
    if(focused)[...table.querySelectorAll('button[data-contract]')].find(b=>b.dataset.contract===focused.id&&b.dataset.quoteSide===focused.side)?.focus({preventScroll:true});
    text('chainEmpty',state.busy?label('Loading'):strikes.length?'':label('NoChain'));$('chainEmpty').hidden=strikes.length>0;
    text('count',`${strikes.length} · ${page+1}/${pages}`);$('previous').disabled=page===0;$('next').disabled=page>=pages-1;
  }
  function centerAtm(horizontal=false){
    const scroller=$('chainScroll'),row=$('chain').querySelector('tr.atm');if(!row)return;
    const bounds=scroller.getBoundingClientRect(),target=row.getBoundingClientRect(),header=$('chain').querySelector('thead').getBoundingClientRect().height;
    scroller.scrollTop=Math.max(0,scroller.scrollTop+target.top-bounds.top+target.height/2-header-(scroller.clientHeight-header)/2);
    if(horizontal&&rightMode==='All')scroller.scrollLeft=(scroller.scrollWidth-scroller.clientWidth)/2;
  }
  function positionStrike(){
    const table=$('chain'),cols=[...table.querySelectorAll('col')],viewport=$('chainScroll').clientWidth;
    table.style.setProperty('--strike-inset',Math.max(0,(viewport-80)/2)+'px');
    const base=cols.reduce((sum,c)=>sum+Number(c.dataset.baseWidth),0),extra=Math.max(0,viewport-base)/Math.max(1,cols.filter(c=>!c.dataset.fixed).length);
    for(const col of cols)col.style.width=(Number(col.dataset.baseWidth)+(col.dataset.fixed?0:extra))+'px';
  }
  function renderLegs(){
    const signature=JSON.stringify([state.legs,state.language]);if(legSignature===signature)return;legSignature=signature;
    headers('legs',[label('Legs'),label('Buy')+'/'+label('Sell'),label('Quantity'),label('Entry'),label('Remove')]);
    const body=$('legs').querySelector('tbody'),existing=new Map([...body.children].map(row=>[row.dataset.id,row]));
    for(const leg of state.legs){
      let row=existing.get(leg.id);
      if(!row){row=element('tr');row.dataset.newLeg='true';row.dataset.id=leg.id;for(let i=0;i<5;i++)cell(row,'');}
      row.children[0].textContent=`${label(leg.type)} ${leg.strike} ${leg.expiration}`;row.children[0].title=row.children[0].textContent;
      let side=row.querySelector('select');if(!side){side=element('select');side.dataset.mutation='true';side.addEventListener('change',()=>send({kind:'edit-leg',id:leg.id,field:'side',side:side.value}));row.children[1].append(side);}
      side.replaceChildren(...[['Long','Buy'],['Short','Sell']].map(([value,k])=>{const o=element('option',label(k));o.value=value;return o;}));side.value=leg.side;side.setAttribute('aria-label',label('Buy')+'/'+label('Sell'));
      let qty=row.querySelector('input');if(!qty){qty=element('input');qty.type='number';qty.min='1';qty.step='1';qty.dataset.mutation='true';qty.addEventListener('change',()=>{const quantity=Number(qty.value);if(!Number.isInteger(quantity)||quantity<1||quantity>Number(qty.max)){qty.value=state.legs.find(l=>l.id===leg.id)?.quantity??'1';message(label('Unavailable'));return;}send({kind:'edit-leg',id:leg.id,field:'quantity',quantity});});row.children[2].append(qty);}
      qty.max=leg.type==='Stock'?'1000000':'1000';qty.setAttribute('aria-label',label('Quantity'));if(document.activeElement!==qty)qty.value=leg.quantity;
      row.children[3].textContent=leg.premium;
      row.children[4].replaceChildren(button('',()=>send({kind:'edit-leg',id:leg.id,field:'remove'})));row.children[4].firstChild.append(meiliIcons.svg('Trash',16));row.children[4].firstChild.setAttribute('aria-label',label('Remove'));
      body.append(row);if(row.dataset.newLeg){delete row.dataset.newLeg;meiliMotion.enter(row);}existing.delete(leg.id);
    }
    for(const row of existing.values())row.remove();text('legsEmpty',state.legs.length?'':label('Empty'));$('legsEmpty').hidden=state.legs.length>0;
  }
  function svg(tag,attrs,value){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(value!==undefined)e.textContent=value;return e;}
  function renderCurve(){
    const plot=$('payoff'),points=state.curve.filter(p=>finite(p.price)&&finite(p.expiry));plot.replaceChildren();
    $('emptyCurve').hidden=points.length>1;text('emptyCurve',state.legs.length?label('Unavailable'):label('Empty'));plot.style.display=points.length>1?'block':'none';$('priceSlider').disabled=points.length<2;
    if(points.length<2){domain=null;return;}
    const width=Math.max(plot.clientWidth,360),height=Math.max(plot.clientHeight,180),left=62,right=14,top=18,bottom=34;
    plot.setAttribute('viewBox',`0 0 ${width} ${height}`);plot.setAttribute('aria-label',label('Curve'));
    const fullLow=points[0].price,fullHigh=points.at(-1).price;
    if(!viewport||viewport.high-viewport.low>=fullHigh-fullLow)viewport={low:fullLow,high:fullHigh};
    const span=viewport.high-viewport.low;
    viewport.low=Math.max(fullLow,Math.min(fullHigh-span,viewport.low));viewport.high=viewport.low+span;
    const {low,high}=viewport,visible=points.filter(p=>p.price>=low&&p.price<=high),values=(visible.length?visible:points).flatMap(p=>[p.expiry,...(finite(p.horizon)?[p.horizon]:[])]);
    let min=Math.min(0,...values),max=Math.max(0,...values);const pad=Math.max((max-min)*.08,1);min-=pad;max+=pad;
    const x=p=>left+(p-low)/(high-low||1)*(width-left-right),y=p=>top+(max-p)/(max-min)*(height-top-bottom);
    domain={low,high,fullLow,fullHigh,left,right,width};
    const defs=svg('defs',{}),clip=svg('clipPath',{id:'plotClip'});clip.append(svg('rect',{x:left,y:top,width:width-left-right,height:height-top-bottom}));defs.append(clip);plot.append(defs);
    for(let i=0;i<=4;i++){
      const price=low+(high-low)*i/4,pnl=min+(max-min)*i/4;
      plot.append(svg('line',{x1:left,y1:y(pnl),x2:width-right,y2:y(pnl),stroke:state.theme.grid}));
      plot.append(svg('text',{x:left-6,y:y(pnl)+4,'text-anchor':'end',fill:state.theme.muted,'font-size':12},number(pnl,0)));
      plot.append(svg('text',{x:x(price),y:height-10,'text-anchor':i===0?'start':i===4?'end':'middle',fill:state.theme.muted,'font-size':12},number(price,1)));
    }
    const data=field=>points.filter(p=>finite(p[field])).map((p,i)=>(i?'L':'M')+x(p.price)+','+y(p[field])).join(' ');
    plot.append(svg('line',{x1:left,y1:y(0),x2:width-right,y2:y(0),stroke:state.theme.muted,'stroke-dasharray':'4 4'}));
    plot.append(svg('path',{d:data('expiry'),fill:'none',stroke:state.theme.up,'stroke-width':2.5,'data-series':'expiry','clip-path':'url(#plotClip)'}));
    const zero=Math.max(top,Math.min(height-bottom,y(0)));
    const gain=svg('clipPath',{id:'gainClip'}),loss=svg('clipPath',{id:'lossClip'});
    gain.append(svg('rect',{x:left,y:top,width:width-left-right,height:Math.max(0,zero-top)}));
    loss.append(svg('rect',{x:left,y:zero,width:width-left-right,height:Math.max(0,height-bottom-zero)}));defs.append(gain,loss);
    const area=data('expiry')+` L ${x(points.at(-1).price)},${y(0)} L ${x(points[0].price)},${y(0)} Z`;
    for(const [clipId,color]of [['gainClip',state.theme.up],['lossClip',state.theme.down]]){
      plot.append(svg('path',{d:area,fill:color,opacity:.12,'clip-path':`url(#${clipId})`,'aria-hidden':'true','pointer-events':'none'}));
    }
    plot.append(svg('path',{d:data('expiry'),fill:'none',stroke:state.theme.down,'stroke-width':2.5,'clip-path':'url(#lossClip)','aria-hidden':'true','pointer-events':'none'}));
    if(points.some(p=>finite(p.horizon)))plot.append(svg('path',{d:data('horizon'),fill:'none',stroke:state.theme.colors[1],'stroke-width':2,'stroke-dasharray':'6 4','data-series':'horizon','clip-path':'url(#plotClip)'}));
    if(finite(state.spot))plot.append(svg('line',{x1:x(state.spot),x2:x(state.spot),y1:top,y2:height-bottom,stroke:state.theme.muted,'stroke-dasharray':'3 4','clip-path':'url(#plotClip)'}));
    if(finite(state.whatIf.price))plot.append(svg('line',{x1:x(state.whatIf.price),x2:x(state.whatIf.price),y1:top,y2:height-bottom,stroke:state.theme.accent,'stroke-width':2,'data-what-if':'true','clip-path':'url(#plotClip)'}));
    const slider=$('priceSlider');slider.min=fullLow;slider.max=fullHigh;slider.step=Math.max((fullHigh-fullLow)/1000,.01);if(document.activeElement!==slider)slider.value=state.whatIf.price??state.spot??low;
  }
  function render(next){
    if(!initialSideResolved&&!next.busy){const types=new Set(next.legs.filter(l=>l.type==='Call'||l.type==='Put').map(l=>l.type));rightMode=types.size>1?'All':types.has('Put')?'Put':'Call';initialSideResolved=true;}
    if(state?.symbol!==next.symbol||!next.curve.length)viewport=null;
    state=next;acceptColumns();clearTimeout(pendingTimer);lock(false);document.documentElement.lang=state.language;document.documentElement.dataset.reducedMotion=String(state.theme.reducedMotion===true);document.documentElement.style.colorScheme=state.theme.dark?'dark':'light';
    const t=state.theme;for(const [k,v]of Object.entries({brand:t.brand,focus:t.focus,link:t.link,input:t.input,hover:t.hover,pressed:t.pressed,danger:t.danger,healthy:t.healthy,background:t.background,text:t.text,muted:t.muted,control:t.control,border:t.border,accent:t.accent,up:t.up,down:t.down,'error-background':t.errorBackground,'error-text':t.errorText,'trading-canvas':t.tradingCanvas,'trading-surface':t.tradingSurface,'trading-edge':t.tradingEdge,'trading-muted':t.tradingMuted,'buy-quote':t.buyQuote,'sell-quote':t.sellQuote}))document.documentElement.style.setProperty('--'+k,v);
    text('context',[state.expiration,state.delayText].filter(Boolean).join(' · '));$('context').title=[state.headline,state.sourceText,state.model,state.asOf,state.fetchedAt].filter(Boolean).join(' · ');message(state.message||(!state.busy&&!state.contracts.length?state.status:'')||'');
    for(const [id,k]of Object.entries({chainTitle:'Chain',legsTitle:'Legs',nearLabel:'Near',clear:'Clear',draft:'Draft',curveTitle:'Curve',fit:'Fit'}))text(id,label(k));
    text('draft',label('Draft')+(state.draftSymbol?' · '+state.draftSymbol:''));
    for(const span of document.querySelectorAll('.empty-contracts span'))if(!span.firstChild)span.append(meiliIcons.svg('Add',18));
    for(const [id,icon]of [['previous','ChevronLeft'],['next','ChevronRight']])if(!$(id).querySelector('svg'))$(id).replaceChildren(meiliIcons.svg(icon,16));
    $('previous').setAttribute('aria-label',label('Previous'));$('next').setAttribute('aria-label',label('Next'));
    $('search').placeholder=label('Search');$('search').setAttribute('aria-label',label('Search'));$('right').setAttribute('aria-label',label('Call')+'/'+label('Put'));
    for(const kind of ['Call','Put','All']){const b=$('right'+kind);b.textContent=label(kind==='All'?'Both':kind);b.setAttribute('aria-selected',String(rightMode===kind));b.tabIndex=rightMode===kind?0:-1;}
    const expiration=$('expiration');if(document.activeElement!==expiration){expiration.replaceChildren(...(state.expirations??[]).map(e=>{const option=element('option',e.label);option.value=e.date;return option;}));expiration.value=state.expiration??'';}expiration.disabled=state.busy||pending;expiration.setAttribute('aria-label',label('Expiration'));
    $('centerAtm').title=label('CenterAtm');$('centerAtm').disabled=state.busy||!finite(state.spot)||!state.contracts.length;
    text('instrumentSymbol',state.symbol);text('instrumentMark',state.symbol?.slice(0,1));text('companyName',state.companyName??'');text('liveQuote',state.livePrice??'');$('liveQuote').title=state.livePriceTip??'';text('paperBadge',label('Draft'));
    text('emptyTitle',label(state.busy?'Loading':'EmptyTitle'));text('emptyHint',label('EmptyHint'));if(state.legs.length)text('legsTitle',[state.draftSymbol,state.strategyName||label('Legs')].filter(Boolean).join(' · '));text('startSelecting',label('StartSelecting'));
    document.querySelector('#ticketPanel>.panelhead').hidden=state.legs.length===0;
    $('draftEmpty').hidden=state.legs.length>0;$('metrics').hidden=state.legs.length===0;$('curvePanel').hidden=state.legs.length===0;document.querySelector('.legsScroll').hidden=state.legs.length===0;$('clear').hidden=state.legs.length===0;
    renderColumnPicker();$('horizon').setAttribute('aria-label',label('Expiry'));$('horizon').value=state.horizonDays;
    renderChain();renderLegs();
    const metrics=$('metrics');metrics.replaceChildren();for(const [k,v]of Object.entries({Cost:state.metrics.cost,Profit:state.metrics.maxProfit,Loss:state.metrics.maxLoss,Breakeven:state.metrics.breakeven,Margin:state.metrics.margin,Greeks:state.greeks?`Δ ${number(state.greeks.delta)} Γ ${number(state.greeks.gamma,3)} Θ ${number(state.greeks.theta)} Vega ${number(state.greeks.vega)}`:state.metrics.greeks})){
      const div=element('div',undefined,'metric');div.dataset.metric=k;div.append(element('span',label(k)),element('strong',v));metrics.append(div);
    }
    renderCurve();text('whatif',`${label('WhatIf')} ${number(state.whatIf.price)} · ${label('Pnl')} ${state.whatIf.pnl}`);$('whatif').className=state.whatIf.isProfit?'up':state.whatIf.isLoss?'down':'';
    $('priceSlider').setAttribute('aria-label',label('WhatIf'));text('curveLegend',[state.expiryLabel,state.horizonLabel].filter(Boolean).join(' · '));text('notes',[state.sourceText,state.model,state.note,state.status,label('Hint')].filter(Boolean).join(' · '));$('notes').closest('details').querySelector('summary').setAttribute('aria-label',label('Hint'));$('notes').closest('details').querySelector('summary').title=label('Hint');$('detailsLabel').replaceChildren(meiliIcons.svg('Info',16));text('coverageNotice',state.truncated?label('Truncated'):'');
    lock(false);document.title='EasySellPut Strategy · '+state.symbol;
    diagnostic({status:'rendered',kindOfView:'workbench',key:state.key,columns:state.columns,visibleColumnCount:$('chain').querySelector('tr[data-strike]')?.children.length??0,contracts:state.contracts.length,legs:state.legs.length,points:state.curve.length,renderedPoints:($('payoff').querySelector('[data-series=expiry]')?.getAttribute('d').match(/[ML]/g)??[]).length,quantities:state.legs.map(l=>l.quantity),whatIf:state.whatIf.price,background:state.theme.tradingCanvas??state.theme.background,maxProfit:state.metrics.maxProfit});
  }
  $('search').addEventListener('input',()=>{page=0;renderChain(true);});for(const kind of ['Call','Put','All'])$('right'+kind).addEventListener('click',()=>{initialSideResolved=true;rightMode=kind;page=0;for(const k of ['Call','Put','All']){$('right'+k).setAttribute('aria-selected',String(k===kind));$('right'+k).tabIndex=k===kind?0:-1;}renderChain(true);});$('near').addEventListener('change',()=>{page=0;renderChain(true);});
  $('centerAtm').addEventListener('click',()=>{$('search').value='';centeredViewKey=null;renderChain(true);});
  $('expiration').dataset.mutation='true';$('expiration').addEventListener('change',()=>send({kind:'select-expiration',expiration:$('expiration').value}));
  $('startSelecting').addEventListener('click',()=>{$('centerAtm').click();const target=$('chain').querySelector('tr.atm button.buy:not(:disabled)')??$('chain').querySelector('button[data-contract]:not(:disabled)');target?.scrollIntoView({block:'nearest',inline:'nearest'});target?.focus({preventScroll:true});});
  new ResizeObserver(positionStrike).observe($('chainScroll'));
  $('previous').addEventListener('click',()=>{page--;renderChain(true);});$('next').addEventListener('click',()=>{page++;renderChain(true);});
  $('clear').dataset.mutation='true';$('clear').addEventListener('click',()=>send({kind:'clear-legs'}));$('horizon').dataset.mutation='true';$('horizon').addEventListener('change',()=>send({kind:'horizon',days:Number($('horizon').value)}));
  $('priceSlider').addEventListener('input',()=>{hover=Number($('priceSlider').value);});
  $('payoff').addEventListener('pointermove',e=>{if(!domain)return;const rect=$('payoff').getBoundingClientRect();if(drag){const shift=(e.clientX-drag.x)/rect.width*(drag.high-drag.low);viewport={low:drag.low-shift,high:drag.high-shift};renderCurve();return;}const position=(e.clientX-rect.left)/rect.width*domain.width;hover=Math.max(domain.low,Math.min(domain.high,domain.low+(position-domain.left)/(domain.width-domain.left-domain.right)*(domain.high-domain.low)));});
  $('payoff').addEventListener('keydown',e=>{if(!domain||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();hover=Math.max(domain.low,Math.min(domain.high,(state.whatIf.price??state.spot??domain.low)+(e.key==='ArrowLeft'?-1:1)*(domain.high-domain.low)/100));});
  $('payoff').addEventListener('wheel',e=>{
    if(!domain)return;e.preventDefault();
    const rect=$('payoff').getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-domain.left)/(rect.width-domain.left-domain.right)));
    const factor=Math.exp(Math.sign(e.deltaY)*.2),span=Math.max((domain.fullHigh-domain.fullLow)/40,Math.min(domain.fullHigh-domain.fullLow,(domain.high-domain.low)*factor));
    const center=domain.low+ratio*(domain.high-domain.low),low=center-ratio*span;viewport={low,high:low+span};renderCurve();
  },{passive:false});
  $('payoff').addEventListener('pointerdown',e=>{if(!domain||e.button!==0)return;drag={x:e.clientX,low:domain.low,high:domain.high};$('payoff').setPointerCapture(e.pointerId);});
  for(const kind of ['pointerup','pointercancel'])$('payoff').addEventListener(kind,()=>drag=null);
  $('fit').addEventListener('click',()=>{viewport=null;renderCurve();});new ResizeObserver(()=>{if(state)renderCurve();}).observe($('curvePanel'));
  setInterval(()=>{if(finite(hover)&&state&&!state.busy&&!pending){const price=hover;hover=null;fetch('event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'what-if',key:state.key,price})}).catch(()=>{});}},120);
  $('workbenchDetails').addEventListener('toggle',()=>{if($('workbenchDetails').open)meiliMotion.enter($('notes'));});
  async function poll(){try{const response=await fetch('state?after='+version,{cache:'no-store'});if(response.status===200){const update=await response.json();if(update.version>0){render(update.data);version=update.version;}}else if(response.status!==204)throw new Error('State HTTP '+response.status);}catch(e){message(label('Unavailable'));diagnostic({status:'error',message:String(e).slice(0,250)});}setTimeout(poll,250);}
  window.addEventListener('error',e=>diagnostic({status:'error',message:String(e.message).slice(0,250)}));
  window.meiliWorkbench={inspect:()=>({state,domain}),render};poll();
})();
