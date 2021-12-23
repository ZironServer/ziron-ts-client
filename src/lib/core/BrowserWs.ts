/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

declare var WorkerGlobalScope: any;
const globalScope = typeof WorkerGlobalScope !== 'undefined' ? self :
    typeof window !== 'undefined' && window || (function(this: any) {return this;})();
const GlobalWebSocket = (typeof globalScope === 'object' && globalScope) &&
    window.WebSocket || (window as any).MozWebSocket;
if(GlobalWebSocket == null) module.exports = null;
else {
    /**
     * @description
     * WS module browser polyfill.
     * Notice that the third argument opts gets ignored.
     * @param uri
     * @param protocols
     * @param opts
     */
    function Ws(uri: string, protocols?: string | string[], opts?: any) {
        return protocols != null ? new GlobalWebSocket(uri,protocols) : new GlobalWebSocket(uri);
    }
    Ws.prototype = GlobalWebSocket.prototype;
    module.exports = Ws;
}