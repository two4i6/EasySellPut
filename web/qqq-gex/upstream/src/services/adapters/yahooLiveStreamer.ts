import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { qqqMarketSession } from '@/lib/qqqMarketSession';

// Yahoo Finance 内部实时行情推送协议（wss://streamer.finance.yahoo.com），字段号来自社区逆向的 yaticker.proto。
const YATICKER_PROTO = `
syntax = "proto3";
message Yaticker {
  string id = 1;
  float price = 2;
  sint64 time = 3;
  string currency = 4;
  string exchange = 5;
  int32 quoteType = 6;
  int32 marketHours = 7;
  float changePercent = 8;
  sint64 dayVolume = 9;
  float dayHigh = 10;
  float dayLow = 11;
  float change = 12;
  string shortName = 13;
}`;

export type YahooLiveTick = { symbol: string; price: number; time: number; change: number; changePercent: number; marketHours?: number };

const YATICKER = protobuf.parse(YATICKER_PROTO).root.lookupType('Yaticker');
const STREAM_URL = 'wss://streamer.finance.yahoo.com/?version=2';

export class YahooLiveStreamer {
  private static instance: YahooLiveStreamer;
  private socket: WebSocket | null = null;
  private readonly subscribersBySymbol = new Map<string, Set<(tick: YahooLiveTick) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastQqqTickAt = 0;

  constructor(private readonly createSocket: () => WebSocket = () => new WebSocket(STREAM_URL)) {}

  static getInstance() {
    return (YahooLiveStreamer.instance ??= new YahooLiveStreamer());
  }

  subscribe(symbol: string, listener: (tick: YahooLiveTick) => void) {
    const key = symbol.toUpperCase();
    let set = this.subscribersBySymbol.get(key);
    if (!set) {
      set = new Set();
      this.subscribersBySymbol.set(key, set);
    }
    set.add(listener);
    this.ensureConnected();
    this.resubscribeSymbols();
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.subscribersBySymbol.delete(key);
        if (!this.subscribersBySymbol.size) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
          this.clearHealthTimer();
          const socket = this.socket; this.socket = null;
          socket?.close();
        } else this.resubscribeSymbols();
      }
    };
  }

  private ensureConnected() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.createSocket();
    this.socket = socket;
    const startedAt = Date.now(); let lastPongAt = startedAt;
    this.lastQqqTickAt = startedAt;
    socket.on('open', () => {
      if (this.socket !== socket) return;
      lastPongAt = this.lastQqqTickAt = Date.now(); this.resubscribeSymbols();
    });
    socket.on('message', (raw) => { if (this.socket === socket) this.handleMessage(raw); });
    socket.on('pong', () => { if (this.socket === socket) lastPongAt = Date.now(); });
    socket.on('close', () => this.scheduleReconnect(socket));
    socket.on('error', () => socket.terminate());
    this.clearHealthTimer();
    this.healthTimer = setInterval(() => {
      if (this.socket !== socket) return;
      const now = Date.now();
      const connectingExpired = socket.readyState === WebSocket.CONNECTING && now - startedAt > 30_000;
      const quoteStalled = this.subscribersBySymbol.has('QQQ') && qqqMarketSession(new Date(now)).stocksOpen && now - this.lastQqqTickAt > 60_000;
      if (connectingExpired || socket.readyState === WebSocket.OPEN && (now - lastPongAt > 45_000 || quoteStalled)) { socket.terminate(); return; }
      if (socket.readyState === WebSocket.OPEN) { try { socket.ping(); } catch { socket.terminate(); } }
    }, 15_000);
    this.healthTimer.unref?.();
  }

  private clearHealthTimer() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  private scheduleReconnect(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.clearHealthTimer();
    if (this.subscribersBySymbol.size === 0) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subscribersBySymbol.size > 0) this.ensureConnected();
    }, 2000);
  }

  private resubscribeSymbols() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const symbols = [...this.subscribersBySymbol.keys()];
    if (symbols.length) this.socket.send(JSON.stringify({ subscribe: symbols }));
  }

  private handleMessage(raw: WebSocket.RawData) {
    try {
      const payload = JSON.parse(raw.toString());
      if (typeof payload.message !== 'string') return;
      const decoded = YATICKER.decode(Buffer.from(payload.message, 'base64')) as unknown as {
        id: string; price: number; time: number | { toNumber(): number }; change: number; changePercent: number; marketHours?: number;
      };
      const listeners = this.subscribersBySymbol.get(decoded.id?.toUpperCase());
      if (!listeners?.size) return;
      const timeMs = typeof decoded.time === 'number' ? decoded.time : decoded.time.toNumber();
      const tick: YahooLiveTick = { symbol: decoded.id, price: decoded.price, time: Math.floor(timeMs / 1000), change: decoded.change, changePercent: decoded.changePercent, marketHours: decoded.marketHours };
      if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.time)) return;
      const now = Date.now();
      if (tick.symbol.toUpperCase() === 'QQQ' && now - tick.time * 1000 <= 45_000 && tick.time * 1000 <= now + 5000) this.lastQqqTickAt = now;
      // A cancelled SSE controller must not starve every later subscriber.
      for (const listener of listeners) { try { listener(tick); } catch { /* Isolate disconnected consumers. */ } }
    } catch {
      // 忽略无法解析的心跳/非行情帧
    }
  }
}

export const yahooLiveStreamer = YahooLiveStreamer.getInstance();
