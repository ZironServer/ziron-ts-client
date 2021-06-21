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

export let createWebSocket: (url: string,protocol: string,options?: ClientOptions) => WebSocket;
if (typeof window === 'object' && window.WebSocket) {
    createWebSocket = (url,protocol) => new (window as any).WebSocket(url,protocol);
}
else if(typeof window === 'object' && (window as any).MozWebSocket) {
    createWebSocket = (url,protocol) => new (window as any).MozWebSocket(url,protocol);
}
else {
    const WsWebSocket = require('ws');
    createWebSocket = (url,protocol, options) => new WsWebSocket(url, protocol, options);
}