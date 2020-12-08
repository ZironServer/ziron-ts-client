import {ClientOptions} from 'ws';

export interface WebSocket {
    close(code?: number, reason?: string): void;
    send(data: string | ArrayBuffer | Blob): void;
    onopen: (event: any) => void;
    onclose: (event: any) => void;
    onmessage: (event: any) => void;
    onerror: (event: any) => void;
    binaryType: 'arraybuffer' | 'blob';
}

export let createWebSocket: (url: string,options?: ClientOptions) => WebSocket;
if (typeof window === 'object' && window.WebSocket) {
    createWebSocket = (url) => new (window as any).WebSocket(url);
}
else if(typeof window === 'object' && (window as any).MozWebSocket) {
    createWebSocket = (url) => new (window as any).MozWebSocket(url);
}
else {
    const WsWebSocket = require('ws');
    createWebSocket = (url, options) => new WsWebSocket(url, null, options);
}