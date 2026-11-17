// Local build adapter observes presentation state without changing pinned source kernels.
export function observeUi(contents,file){
 // esbuild receives native Windows paths and checkout line endings.
 file=file.replaceAll('\\','/');contents=contents.replaceAll('\r\n','\n');
 const hooks=[
  ['QqqExposureWorkbench.tsx',`  const selectedStrikes=useMemo(()=>new Set(strikeKey?strikeKey.split(',').map(Number):[]),[strikeKey]);`,'exposure',{date:'data.view.date',expiry:'selectedExpiry',scope:'scope',cursor:'cursor',effectiveAt:'frame?.time??null',playing:'playing',playbackSpeed:'playbackSpeed',heatmapView:'heatmapView',mode:'mode',metric:'metric',radius:'radius',gain:'gain',keys:'keys',heat:'heat',historyMarks:'historyMarks',dayRange:'dayRange',overlays:'overlays',reactions:'reactions',discovery:'discovery',changeMinutes:'changeMinutes',focusedStrike:'focusedStrike',strikeHover:'strikeHover',observationMinutes:'observationMinutes',inverted:'inverted',smooth:'smooth',barZoom:'barZoom',selectedStrikes:'[...selectedStrikes]'}],
  ['QqqWallTouchStatsCard.tsx','  const stats = useMemo(() => summarizeWallTouches(events), [events]);','wallTouches',{date:'date',expiry:'expiry',dte:'dte',gamma:'gamma',period:'period',side:'side',horizon:'horizon',statsKnown:'statsKnown'}],
  ['QqqSpreadStudyCard.tsx','  return <div>','spreadStudy',{date:'study.date',expiry:'study.expiry',cutoff:'study.cutoff',side:'side',basis:'basis',ivShockPp:'shock',fees:'fees',manualCredit:'manual',shortStrike:'short',longStrike:'long'}]
 ];
 for(const [name,anchor,key,fields] of hooks){
  if(!file.endsWith('/'+name))continue;
  if(!contents.includes(anchor))throw Error('Pinned UI observation anchor changed: '+name);
  const values=Object.entries(fields).map(([k,v])=>k+':'+v).join(','),dependencies=[...new Set(Object.values(fields).map(v=>v==='[...selectedStrikes]'?'selectedStrikes':v))].join(',');
  const hook=`\n  useEffect(()=>{try{const key='qqq-local:observed-${key}:v1',value={${values}};let previous;try{previous=JSON.parse(localStorage.getItem(key)??'null');}catch{}if(previous&&typeof previous==='object'&&!Array.isArray(previous)){delete previous.observedAt;if(JSON.stringify(previous)===JSON.stringify(value))return;}localStorage.setItem(key,JSON.stringify({observedAt:new Date().toISOString(),...value}));}catch{}},[${dependencies}]);\n`;
  contents=key==='spreadStudy'?contents.replace(anchor,hook+anchor):contents.replace(anchor,anchor+hook);
 }
 if(file.endsWith('/QqqPcsGexIntradayChart.tsx')){
  const anchor='    return <>\n      {showGex && !tooltipDetails';
  if(!contents.includes(anchor))throw Error('Pinned chart cursor observation anchor changed');
  contents=contents.replace(anchor,'    return <>\n      <span hidden data-qqq-hover={JSON.stringify({hover,hoverDetails,granularity,tooltipDetails})} />\n      {showGex && !tooltipDetails');
 }
 return contents;
}
