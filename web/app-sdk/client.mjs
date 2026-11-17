/** Private signed AppView client. No shell/browser bridge, market socket, storage or implicit writable connection. */
export function createAppClient(page = globalThis.location) {
  const url = new URL(page.href);
  const token = url.pathname.split('/')[1];
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !/^[A-Fa-f0-9]{64}$/.test(token))
    throw Error('A private AppView origin is required');
  const root = new URL('/' + token + '/host/', url.origin);
  async function request(route, body, { signal, timeout = 30000 } = {}) {
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120000) throw Error('Invalid request timeout');
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(new URL(route, root), { method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      if (!response.ok) throw Error('Application request failed (' + response.status + ')');
      const value = await response.json();
      if (value.success === false) throw Error(value.error?.message ?? 'Application operation failed');
      return value;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  async function* presentationChanges(signal) {
    if(!signal)throw Error('A presentation lifetime signal is required');
    let version=-1;
    while(!signal.aborted){
      let snapshot;
      try{snapshot=await request('presentation?version='+version,undefined,{signal,timeout:30000});}
      catch(error){if(signal.aborted)return;throw error;}
      if(snapshot.version!==version){version=snapshot.version;yield snapshot;}
    }
  }
  return Object.freeze({ presentation: options=>request('presentation',undefined,options), presentationChanges, list: options => request('catalog', undefined, options),
    call: (operation, args = {}, options) => request('invoke', { operation, arguments: args }, options) });
}
