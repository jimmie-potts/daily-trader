import WebSocket, { type RawData } from 'ws';

import {
  type WebSocketEventListener,
  type WebSocketEventType,
  type WebSocketFactory,
  type WebSocketLike,
} from './types.js';

type NodeWebSocketListener =
  | (() => void)
  | ((code: number, reason: Buffer) => void)
  | ((error: Error) => void)
  | ((data: RawData, isBinary: boolean) => void);

function utf8Text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

class NodeWebSocketAdapter implements WebSocketLike {
  readonly #socket: WebSocket;
  readonly #listeners = new Map<
    WebSocketEventType,
    Map<WebSocketEventListener, NodeWebSocketListener>
  >();

  public constructor(url: string) {
    this.#socket = new WebSocket(url, {
      maxPayload: 65_536,
      perMessageDeflate: false,
    });
  }

  public addEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    const listeners =
      this.#listeners.get(type) ?? new Map<WebSocketEventListener, NodeWebSocketListener>();
    if (listeners.has(listener)) return;

    let wrapped: NodeWebSocketListener;
    switch (type) {
      case 'close':
        wrapped = (code: number): void => listener({ code });
        this.#socket.on('close', wrapped);
        break;
      case 'error':
        wrapped = (): void => listener({ type: 'error' });
        this.#socket.on('error', wrapped);
        break;
      case 'message':
        wrapped = (data: RawData, isBinary: boolean): void =>
          listener({ data: isBinary ? undefined : utf8Text(data) });
        this.#socket.on('message', wrapped);
        break;
      case 'open':
        wrapped = (): void => listener({ type: 'open' });
        this.#socket.on('open', wrapped);
        break;
    }
    listeners.set(listener, wrapped);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: WebSocketEventType, listener: WebSocketEventListener): void {
    const listeners = this.#listeners.get(type);
    if (listeners === undefined) return;
    const wrapped = listeners.get(listener);
    if (wrapped === undefined) return;

    switch (type) {
      case 'close':
        this.#socket.off('close', wrapped as (code: number, reason: Buffer) => void);
        break;
      case 'error':
        this.#socket.off('error', wrapped as (error: Error) => void);
        break;
      case 'message':
        this.#socket.off('message', wrapped as (data: RawData, isBinary: boolean) => void);
        break;
      case 'open':
        this.#socket.off('open', wrapped as () => void);
        break;
    }
    listeners.delete(listener);
    if (listeners.size === 0) this.#listeners.delete(type);
  }

  public send(data: string): void {
    this.#socket.send(data);
  }

  public close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  public terminate(): void {
    this.#socket.terminate();
  }
}

/** Creates a bounded Node WebSocket transport with an explicit hard-close operation. */
export function createNodeWebSocketFactory(): WebSocketFactory {
  return Object.freeze({
    create: (url: string): WebSocketLike => new NodeWebSocketAdapter(url),
  });
}
