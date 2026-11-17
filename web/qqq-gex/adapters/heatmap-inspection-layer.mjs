// Presentation only: keep the source hit target in place; portal its passive
// status/highlight above later SVG labels without changing financial inputs.
function once(source,anchor,replacement){
 if(source.split(anchor).length!==2)throw Error('Pinned heatmap layer anchor changed: '+anchor.slice(0,70));
 return source.replace(anchor,replacement);
}
export function layerHeatmapInspection(source,file){
 if(file.endsWith('/QqqExposureWorkbench.tsx')){
  source=once(source,'  const selectedStrikes=','  const [inspectionTarget,setInspectionTarget]=useState<SVGGElement|null>(null);\n  const selectedStrikes=');
  const inspector=source.match(/^          <QqqHeatmapInspector .*\/>$/m)?.[0];
  if(!inspector)throw Error('Pinned heatmap inspector placement changed');
  source=once(source,inspector,inspector.replace(' mode={mode}/>',' mode={mode} statusTarget={inspectionTarget}/>'));
  source=once(source,'        </svg>:null,[','          <g ref={setInspectionTarget} data-qqq-inspection-overlay pointerEvents="none" />\n        </svg>:null,[inspectionTarget,');
 }
 if(file.endsWith('/QqqHeatmapInspector.tsx')){
  source=once(source,"'use client';","'use client';\nimport { createPortal } from 'react-dom';");
  source=once(source,"mode='gamma' }: {","mode='gamma', statusTarget=null }: {");
  source=once(source,'frames?:readonly ExposureFrame[]; mode?:ExposureMode;','frames?:readonly ExposureFrame[]; mode?:ExposureMode; statusTarget?:SVGGElement|null;');
  source=once(source,'{current && <g pointerEvents="none">','{current && statusTarget && createPortal(<g pointerEvents="none" data-qqq-inspection-status>');
  source=once(source,'    </g>}\n  </g>;','    </g>,statusTarget)}\n  </g>;');
  source=once(source,"background: '#111827f2'","background: '#111827'");
  source=once(source,'<rect x={current.left}','<rect clipPath="url(#qqq-exposure-clip)" x={current.left}');
 }
 return source;
}
