/** Shared invalidation token with a process fallback. Missing/evicted tokens
 * must not resurrect old cache keys; failed invalidation fences the old token. */
export function createCacheGeneration(ports:{
 get:(space:string,key:string)=>Promise<{data:string;expiresAt:number}|null>;
 set:(space:string,key:string,value:string,expiresAt:number)=>Promise<unknown>;
 initialize?:(space:string,key:string,value:string,expiresAt:number)=>Promise<unknown>;
 space:string;key:string;now?:()=>number;
}){
 const now=ports.now??Date.now;
 let fallback=crypto.randomUUID(),lastShared:string|null=null,rejected:string|null=null,initializing:Promise<string>|null=null;
 const readShared=async()=>{try{const value=await ports.get(ports.space,ports.key);return value&&value.expiresAt>now()&&typeof value.data==='string'&&value.data.length>0&&value.data.length<=128?value.data:null;}catch{return null;}};
 return {
  async read():Promise<string>{
   const shared=await readShared();
   if(shared){if(shared===rejected)return fallback;lastShared=shared;rejected=null;return shared;}
   if(lastShared){fallback=crypto.randomUUID();lastShared=null;}
   if(!initializing){const seed=fallback;
    const task=(async()=>{try{await (ports.initialize??ports.set)(ports.space,ports.key,seed,now()+86400_000);}catch{}
     const actual=await readShared();if(actual&&actual!==rejected){lastShared=actual;return actual;}return fallback;
    })();initializing=task;void task.finally(()=>{if(initializing===task)initializing=null;}).catch(()=>{});
   }
   return initializing;
  },
  async invalidate(){
   const old=await readShared();fallback=crypto.randomUUID();lastShared=null;rejected=old;
   try{const saved=await ports.set(ports.space,ports.key,fallback,now()+86400_000);if(saved!==false){lastShared=fallback;rejected=null;}}catch{}
  },
 };
}
