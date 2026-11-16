import { NextRequest } from 'next/server';
import { yahooLiveStreamer } from '@/services/adapters/yahooLiveStreamer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') || 'QQQ').toUpperCase();
  let cancel = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let stopped = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};
      const stop = (close: boolean) => {
        if (stopped) return;
        stopped = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener('abort', onAbort);
        if (close) { try { controller.close(); } catch { /* Reader already cancelled. */ } }
      };
      const onAbort = () => stop(true);
      cancel = () => stop(false);
      const send = (event: string, data: unknown) => {
        if (stopped) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { stop(false); }
      };
      unsubscribe = yahooLiveStreamer.subscribe(symbol, (tick) => send('tick', tick));
      if (stopped) { unsubscribe(); return; }
      heartbeat = setInterval(() => send('ping', { time: Date.now() }), 15000);
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    },
    cancel() { cancel(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
