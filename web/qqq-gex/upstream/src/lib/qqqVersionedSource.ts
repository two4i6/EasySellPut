/** Cache immutable source evidence by DB revision; decisions still evaluate at now. */
export function createQqqVersionedSource<T>(readRevision:()=>Promise<string>,load:(revision:string)=>Promise<T>,now=Date.now) {
  let cached:{revision:string;value:T;until:number}|undefined;
  let pending:Promise<T>|undefined;
  return async()=>{
    if(pending)return pending;
    const task=(async()=>{
      for(let attempt=0;attempt<2;attempt++){
        const revision=await readRevision();
        if(cached?.revision===revision && cached.until>now())return cached.value;
        const value=await load(revision);
        // A changed revision invalidates publication as well as cache reuse.
        if(await readRevision()!==revision)continue;
        cached={revision,value,until:now()+300000};
        return value;
      }
      throw Error('GEX source changed during display read; retry');
    })();
    pending=task;try{return await task;}finally{if(pending===task)pending=undefined;}
  };
}
