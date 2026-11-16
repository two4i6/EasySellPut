import React from 'react';
export type RenderDiagnostic={code:'RENDER_FAILED';type:string;category:string;frames:Array<{asset:string;line:number;column:number}>};
/** No exception messages, URLs, tokens, props or market/user payloads leave the renderer. */
export function renderDiagnostic(error:unknown):RenderDiagnostic{
 const e=error as Error,type=['Error','TypeError','RangeError','ReferenceError','SyntaxError'].includes(e?.name)?e.name:'Error',message=String(e?.message??'');
 const category=/Cannot read propert|undefined|null/.test(message)?'null_access':/not a function/.test(message)?'not_callable':type==='RangeError'?'range':'unknown';
 const frames=[...String(e?.stack??'').matchAll(/\/([A-Za-z0-9_.-]{1,80}\.m?js):(\d+):(\d+)/g)].slice(0,4).map(m=>({asset:m[1],line:Number(m[2]),column:Number(m[3])}));
 return {code:'RENDER_FAILED',type,category,frames};
}
export class RecoveryBoundary extends React.Component<React.PropsWithChildren<{onDiagnostic?:(value:RenderDiagnostic)=>void}>,{failed:boolean}>{
 state={failed:false};private automaticRetries=0;private retryPending=false;
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:unknown){this.retryPending=false;this.props.onDiagnostic?.(renderDiagnostic(error));}
 private reopen=()=>{this.retryPending=true;this.setState({failed:false},()=>{this.retryPending=false;});};
 private retry=()=>{this.automaticRetries=0;this.reopen();};
 private resume=()=>{if(this.state.failed&&!this.retryPending&&!document.hidden&&this.automaticRetries<2){this.automaticRetries++;this.reopen();}};
 componentDidMount(){window.addEventListener('online',this.resume);window.addEventListener('pageshow',this.resume);document.addEventListener('visibilitychange',this.resume);}
 componentWillUnmount(){window.removeEventListener('online',this.resume);window.removeEventListener('pageshow',this.resume);document.removeEventListener('visibilitychange',this.resume);}
 render(){return this.state.failed?<section role="alert" style={{padding:'24px'}}><h2>QQQ GEX 视图暂时无法显示</h2><p>视图已停止；这条提示不表示历史缓存损坏。恢复只会重新打开视图，不清除记录。</p><button type="button" onClick={this.retry}>恢复视图</button><p>网络或窗口恢复后会尝试重新打开；连续失败时保留此入口。</p></section>:this.props.children;}
}
