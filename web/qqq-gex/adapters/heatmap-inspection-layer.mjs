// Presentation only. WebKit can composite a canvas in SVG foreignObject above
// later SVG content. Keep the original bitmap behind the SVG in an HTML layer,
// and its passive inspection text above it; leave all financial inputs/hit targets intact.
function once(source,anchor,replacement){
 if(source.split(anchor).length!==2)throw Error('Pinned heatmap layer anchor changed: '+anchor.slice(0,70));
 return source.replace(anchor,replacement);
}
export function layerHeatmapInspection(source,file){
 if(file.endsWith('/QqqExposureWorkbench.tsx')){
  source=once(source,'  const selectedStrikes=','  const [inspectionTarget,setInspectionTarget]=useState<SVGGElement|null>(null);\n  const [inspectionStatusTarget,setInspectionStatusTarget]=useState<HTMLDivElement|null>(null);\n  const selectedStrikes=');
  const inspector=source.match(/^          <QqqHeatmapInspector .*\/>$/m)?.[0];
  const bitmap=source.match(/            <foreignObject[^\n]*>\n\s*(<QqqExposureCanvas[^\n]*\/>)\n            <\/foreignObject>/);
  if(!inspector||!bitmap)throw Error('Pinned heatmap inspector/bitmap placement changed');
  source=once(source,inspector,inspector.replace(' mode={mode}/>',' mode={mode} highlightTarget={inspectionTarget} statusTarget={inspectionStatusTarget}/>'));
  source=once(source,bitmap[0],'');
  source=once(source,'height={plotHeight} fill="#05070b"','height={plotHeight} fill="transparent"');
  source=once(source,'style={{width:chartSize.width,height:chartSize.height}}>','style={{width:chartSize.width,height:chartSize.height,zIndex:1}}>');
  source=once(source,'        </svg>:null,[','          <g ref={setInspectionTarget} data-qqq-inspection-overlay pointerEvents="none" />\n        </svg>:null,[inspectionTarget,inspectionStatusTarget,');
  source=once(source,'>{chartSvg}',`>{chartSvg&&<div data-qqq-heatmap-bitmap style={{position:'absolute',left:0,top:0,width:chartSize.width,height:chartSize.height,pointerEvents:'none',zIndex:0}}>${bitmap[1]}</div>}{chartSvg}<div ref={setInspectionStatusTarget} data-qqq-inspection-overlay-html style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2}} />`);
 }
 if(file.endsWith('/QqqHeatmapInspector.tsx')){
  source=once(source,"'use client';","'use client';\nimport { createPortal } from 'react-dom';");
  source=once(source,"mode='gamma' }: {","mode='gamma', statusTarget=null, highlightTarget=null }: {");
  source=once(source,'frames?:readonly ExposureFrame[]; mode?:ExposureMode;','frames?:readonly ExposureFrame[]; mode?:ExposureMode; statusTarget?:HTMLDivElement|null; highlightTarget?:SVGGElement|null;');
  const status=source.match(/\{current && <g pointerEvents="none">\s*(<rect[^\n]*\/>)\s*<foreignObject[^\n]*>\s*([\s\S]*?)\s*<\/foreignObject>\s*<\/g>\}/);
  if(!status)throw Error('Pinned heatmap status structure changed');
  const highlight=status[1].replace('<rect ','<rect clipPath="url(#qqq-exposure-clip)" ');
  let text=once(status[2],'<div role="status"','<div data-qqq-inspection-status role="status"');
  text=once(text,"style={{ background:","style={{position:'absolute',left:plot.left+4,top:plot.top+4,width:Math.max(1,Math.min(460,plot.width-8)),boxSizing:'border-box',pointerEvents:'none',background:");
  text=once(text,"background: '#111827f2'","background: '#111827'");
  source=once(source,status[0],`{current && <>{highlightTarget&&createPortal(<g pointerEvents="none" data-qqq-inspection-highlight>${highlight}</g>,highlightTarget)}{statusTarget&&createPortal(${text},statusTarget)}</>}`);
 }
 return source;
}
