export interface HostEngine {
  readonly request: {protocol:1;framing:'host-jsonl-v1';operation:string;arguments:Record<string,unknown>;context:{dataDirectory:string;appId:string;appVersion:string;allowWrites:boolean;hostOperations:string[]}};
  call<T=unknown>(operation:string,args:Record<string,unknown>):Promise<T>;
  finish(result:unknown):void;
  close():void;
}
export function createHostEngine(input?:NodeJS.ReadableStream,output?:NodeJS.WritableStream):Promise<HostEngine>;
