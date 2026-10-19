import {vi} from 'vitest';
import {calculateEditPreview,type EditPreviewWorkerRequest,type EditPreviewWorkerReply} from '../../src/browser/edit-preview-worker';
export class ControlledPreviewWorker {
  static instances:ControlledPreviewWorker[]=[];
  onmessage:((event:MessageEvent<EditPreviewWorkerReply>)=>void)|null=null;onerror:((event:Event)=>void)|null=null;onmessageerror:((event:Event)=>void)|null=null;
  request!:EditPreviewWorkerRequest;terminated=false;
  constructor(readonly url:URL,readonly options:WorkerOptions){ControlledPreviewWorker.instances.push(this);}
  postMessage(request:EditPreviewWorkerRequest){this.request=structuredClone(request);}
  terminate(){this.terminated=true;}
  reply(overrides:Partial<EditPreviewWorkerReply>={}){this.onmessage?.({data:{...calculateEditPreview(this.request),...overrides}} as MessageEvent<EditPreviewWorkerReply>);}
}
export function installPreviewWorker(){
  vi.useFakeTimers();ControlledPreviewWorker.instances=[];let sequence=0;const frames=new Map<number,FrameRequestCallback>();
  vi.stubGlobal('Worker',ControlledPreviewWorker);vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  return {workers:ControlledPreviewWorker.instances,flush(ms=0){vi.advanceTimersByTime(ms);const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(performance.now()));},restore(){vi.useRealTimers();vi.unstubAllGlobals();}};
}
