const cleanups=new WeakMap<HTMLElement,()=>void>();
export function registerAppCleanup(root:HTMLElement,dispose:()=>void):void {cleanups.set(root,dispose);}
export function unmountApp(root:HTMLElement):void {const cleanup=cleanups.get(root);cleanups.delete(root);cleanup?.();}
