/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {ClientOptions} from 'ws';

export interface WebSocket {
    close(code?: number, reason?: string): void;
    send(data: string | ArrayBuffer | Blob): void;
    onopen: (event: any) => void;
    onclose: (event: any) => void;
    onmessage: (event: any) => void;
    onerror: (event: any) => void;
    /**
     * @description
     * It gets called when some backpressure
     * has drained from the write buffer.
     * @param backpressure
     */
    ondrain?: (backpressure: number) => void;
    binaryType: 'arraybuffer' | 'blob';
    bufferedAmount: number;
}

function addOnDrainEventToWebSocket<T extends typeof window.WebSocket['prototype']>(socket: T): T {
    let listener, ticker;
    socket.addEventListener("close",() => clearInterval(ticker));
    Object.defineProperty(socket,"ondrain",{
        set(v?: (backpressure: number) => void) {
            const registered = !!listener;
            listener = v;
            if(!registered && listener) {
                if(socket.readyState < 2) {
                    let prevBackpressure = socket.bufferedAmount;
                    ticker = setInterval(() => {
                        const bufferedAmount = socket.bufferedAmount;
                        if(bufferedAmount < prevBackpressure && socket.readyState === 1)
                            listener(bufferedAmount);
                        prevBackpressure = bufferedAmount;
                    },800);
                }
            }
            else if(registered && !listener) clearInterval(ticker);
        },
        get(): any {return listener;}
    });
    return socket;
}

const BrowserWebSocket: typeof window.WebSocket | undefined =
    (typeof window === 'object') && window.WebSocket || (window as any).MozWebSocket;

export let createWebSocket: (url: string,protocol: string,options?: ClientOptions) => WebSocket;
if (BrowserWebSocket != null) {
    createWebSocket = (url,protocol) =>
        addOnDrainEventToWebSocket(new BrowserWebSocket(url,protocol)) as WebSocket;
}
else {
    const WsWebSocket = require('ws');
    createWebSocket = (url,protocol,options) =>
        addOnDrainEventToWebSocket(new WsWebSocket(url,protocol,options)) as WebSocket;
}