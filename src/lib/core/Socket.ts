/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import SocketOptions, {AutoReconnectOptions, DEFAULT_HOSTNAME, DEFAULT_SECURE, getDefaultPort} from "./SocketOptions";
import TokenStoreEngine from "../main/tokenStore/TokenStoreEngine";
import {createWebSocket, WebSocket} from './WebSocket';
import {InternalServerProcedures, InternalServerReceivers, InternalServerTransmits} from "ziron-events";
import {
    BadConnectionType,
    DataType,
    InvokeListener,
    ComplexTypesOption,
    TimeoutError,
    TransmitListener,
    Transport
} from "ziron-engine";
import {Writable} from "../main/utils/Types";
import {EMPTY_HANDLER} from "../main/utils/Constants";
import Deferred from "../main/utils/Deferred";
import {socketProtocolErrorStatuses} from "ziron-errors";
import {ConnectAbortError} from "../main/Errors";
import EventEmitter from "emitix";
import {CancelablePromise, toCancelablePromise} from "../main/utils/CancelablePromise";
import {extractAuthToken} from "../main/utils/AuthToken";
import * as URL from 'url';
import {BatchOption, BatchOptionsValue, CancelableOption, SendTimeoutOption} from "../main/Options";
import {preprocessPath} from "../main/utils/URL";

type LocalEventEmitter = EventEmitter<{
    'error': [Error],
    'connect': [],
    'connectAbort': [number,string],
    'disconnect': [number,string],
    'authTokenChange': [object | null,object | null,boolean],
}>;

type ChEventEmitter = EventEmitter<any>;

export const enum SocketConnectionState {
    Open,
    Connecting,
    Closed
}

export const enum ChannelState {
    Pending,
    Subscribed
}

export const enum UnsubscribeReason {
    Client,
    KickOut,
    BadConnection
}

export type ReceiverListener = (data: any, type: DataType) => void | Promise<void>;
export type ProcedureListener = (data: any,end: (data?: any, processComplexTypes?: boolean) => void,
                                 reject: (err?: any) => void, type: DataType) => void | Promise<void>

type Receivers =
    { readonly [key in InternalServerTransmits]: ReceiverListener } &
    {[key: string]: ReceiverListener | undefined}

type Procedures = {[key: string]: ProcedureListener | undefined}

export default class Socket {

    private readonly options: Required<SocketOptions>;

    private readonly autoReconnectOptions: Required<AutoReconnectOptions> = {
        active: true,
        initialDelay: 5000,
        multiplier: 1.5,
        randomness: 5000,
        maxDelay: 60000
    }

    private readonly _stringifiedHandshakeAttachment?: string;
    private readonly _url: string;

    private _socket: WebSocket;
    private _state: SocketConnectionState = SocketConnectionState.Closed;

    private _channelMap: Record<string,ChannelState> = {};
    private readonly _chEmitter: ChEventEmitter = new EventEmitter();

    private _currentPingTimeout: number = 200000;
    private _pingTimeoutTicker: NodeJS.Timeout;
    private _connectTimeoutTicker: NodeJS.Timeout;
    private _reconnectTimeoutTicker: NodeJS.Timeout;
    private _connectDeferred: Deferred<any>;

    private readonly _tokenStoreEngine: TokenStoreEngine;

    public readonly signedAuthToken: string | null = null;
    public readonly authToken: any | null = null;
    public readonly authenticated: boolean = false;
    private setAuth<PT extends null | object>(authToken: PT, signedAuthToken: PT extends null ? null : string, self: boolean) {
        const oldAuthToken = this.authToken;
        (this as Writable<Socket>).authToken = authToken;
        (this as Writable<Socket>).signedAuthToken = signedAuthToken;
        (this as Writable<Socket>).authenticated = authToken != null;
        if(oldAuthToken !== authToken) {
            this._emit('authTokenChange',authToken,oldAuthToken,self);
            this._processPendingSubscriptions();
        }
    };

    public readonly reconnectAttempts: number = 0;

    public readonly procedures: Procedures = {};
    /**
     * @description
     * Will be called whenever no corresponding Procedure was found.
     * Can be overridden.
     */
    public onUnknownInvoke: InvokeListener = () => {};

    public readonly receivers: Receivers = {
        [InternalServerTransmits.ConnectionReady]: EMPTY_HANDLER,
        [InternalServerTransmits.SetAuthToken]: (signedAuthToken: string) => {
            const authToken = extractAuthToken(signedAuthToken);
            if (authToken) {
                this.setAuth(authToken, signedAuthToken, false);
                // noinspection JSIgnoredPromiseFromCall
                this._tokenStoreEngine.saveToken(signedAuthToken);
            }
        },
        [InternalServerTransmits.RemoveAuthToken]: () => {
            this.setAuth(null,null,false);
            // noinspection JSIgnoredPromiseFromCall
            this._tokenStoreEngine.removeToken();
        },
        [InternalServerTransmits.KickOut]: ([channel,data]: [string,any]) => {
            if(this._channelMap[channel] === ChannelState.Subscribed) {
                this._channelMap[channel] = ChannelState.Pending;
                this._chEmitter.emit('unsubscribe/' + channel, UnsubscribeReason.KickOut, data);
                this._chEmitter.emit('unsubscribe', channel, UnsubscribeReason.KickOut, data);
            }
        },
        [InternalServerTransmits.Publish]: ([channel,data]: [string,any],type: DataType) => {
            if(this.hasSubscribed(channel)) {
                this._chEmitter.emit('publish/' + channel, data, type !== DataType.JSON);
                this._chEmitter.emit('publish', channel, data, type !== DataType.JSON);
            }
        }
    };
    /**
     * @description
     * Will be called whenever no corresponding Receiver was found.
     * Can be overridden.
     */
    public onUnknownTransmit: TransmitListener = () => {};

    //events
    private readonly _localEmitter: LocalEventEmitter = new EventEmitter();
    public readonly once: LocalEventEmitter['once'] = this._localEmitter.once.bind(this._localEmitter);
    public readonly on: LocalEventEmitter['on'] = this._localEmitter.on.bind(this._localEmitter);
    public readonly off: LocalEventEmitter['off'] = this._localEmitter.off.bind(this._localEmitter);
    private readonly _emit: LocalEventEmitter['emit'] = this._localEmitter.emit.bind(this._localEmitter);

    private readonly _transport: Transport;
    private readonly _onMessageHandler;

    /**
     * Creates a new Socket with an URL string.
     * With the second parameter, you can specify the socket's options
     * and overwrite parsed information from the URL.
     * @param url
     * @param options
     */
    constructor(url: string, options?: SocketOptions)
    /**
     * Creates a new Socket with specific options.
     * @param options
     */
    constructor(options?: SocketOptions)
    constructor(v1?: SocketOptions | string, v2?: SocketOptions) {

        const options = typeof v1 === 'string' ?
            Object.assign(Socket.parseOptionsFromUrl(v1),v2 || {}) : v1 || {};

        this.options = {
            hostname: DEFAULT_HOSTNAME,
            port: getDefaultPort(options.secure ?? DEFAULT_SECURE),
            secure: DEFAULT_SECURE,
            path: '/',
            ackTimeout: 7000,
            connectTimeout: 20000,
            invokeSendTimeout: 3000,
            transmitSendTimeout: null,
            autoReconnect: {},
            autoResubscribe: true,
            handshakeAttachment: undefined,
            wsOptions: {},
            tokenStore: null,
            lowSendBackpressureMark: 209715,
            maxPackageBufferSize: Number.POSITIVE_INFINITY,
            binaryContentPacketTimeout: 10000,
            streamsPerPackageLimit: 20,
            chunksCanContainStreams: false
        };
        Object.assign(this.options,options);
        this.options.path = preprocessPath(this.options.path);

        Object.assign(this.autoReconnectOptions,options.autoReconnect);

        this._url = this._createUrl();
        this._stringifiedHandshakeAttachment = this.options.handshakeAttachment != null ?
            JSON.stringify(this.options.handshakeAttachment) : undefined;

        this._tokenStoreEngine = new TokenStoreEngine(options.tokenStore);

        this._transport = new Transport({
            onTransmit: this._onTransmit.bind(this),
            onInvoke: this._onInvoke.bind(this),
            onListenerError: (err) => this._emit('error',err),
            onInvalidMessage: () => this._destroySocket(4400,'Bad message')
        },false);
            hasLowSendBackpressure: this.hasLowSendBackpressure.bind(this)
        this._transport.onPing = () => {
            this._renewPingTimeout();
            this._transport.sendPong();
        };
        this._transport.ackTimeout = this.options.ackTimeout;

        this.flushBuffer = this._transport.flushBuffer.bind(this._transport);
        this.getBufferSize = this._transport.getBufferSize.bind(this._transport);
        this.sendPreparedPackage = this._transport.sendPreparedPackage.bind(this._transport);

        this._onMessageHandler = event => this._transport.emitMessage(event.data);
    }

    /**
     * Parses the information from an URL to the socket options.
     * @param url
     */
    public static parseOptionsFromUrl(url: string): SocketOptions {
        if(!/^([a-zA-Z]*:\/\/)/.test(url)) url = "ws://" + url;
        const parsedUrl = URL.parse(url);

        const options: SocketOptions = {};

        if(parsedUrl.port) {
            const parsedPort = parseInt(parsedUrl.port);
            if(!isNaN(parsedPort)) options.port = parsedPort;
        }
        if(parsedUrl.hostname) options.hostname = parsedUrl.hostname;
        options.secure = parsedUrl.protocol === 'wss:';
        if(parsedUrl.pathname) options.path = parsedUrl.pathname;

        return options;
    }

    public readonly flushBuffer: Transport['flushBuffer'];
    public readonly getBufferSize: Transport['getBufferSize'];
    public readonly sendPreparedPackage: Transport['sendPreparedPackage'];

    private _onInvoke(procedure: string,data: any,end: (data?: any) => void,reject: (err?: any) => void, type: DataType) {
        if(this.procedures[procedure]) return this.procedures[procedure]!(data,end,reject,type);
        this.onUnknownInvoke(procedure,data,end,reject,type);
    }

    private _onTransmit(receiver: string,data: any,type: DataType) {
        if(this.receivers[receiver]) return this.receivers[receiver]!(data,type);
        this.onUnknownTransmit(receiver,data,type);
    }

    async connect(timeout?: number): Promise<any> {
        if(this._state === SocketConnectionState.Closed) {
            this._state = SocketConnectionState.Connecting;

            clearTimeout(this._reconnectTimeoutTicker);

            const connectDeferred = new Deferred<void>();
            this._connectDeferred = connectDeferred;

            try {
                const protocolHeader = await this._createHandshakeProtocolHeader();

                this._connectTimeoutTicker = setTimeout(this._boundConnectTimeoutReached,
                    timeout || this.options.connectTimeout);

                const socket = createWebSocket(this._createHandshakeUrl(),protocolHeader,this.options.wsOptions);
                this._socket = socket;

                socket.binaryType = 'arraybuffer';
                socket.onmessage = this._onMessageHandler;
                socket.onclose = this._boundOnSocketClose;
                socket.onerror = this._boundOnSocketError;
                socket.onopen = this._boundOnSocketOpen;
                socket.ondrain = this._boundOnSocketDrain;
                this._transport.send = (data: string | Buffer | ArrayBuffer) => {
                    try { socket.send(data); }
                    catch (err) { this._destroySocket(1006, err.toString()); }
                }
            }
            catch (err) {connectDeferred.reject(err)}
        }
        return this._connectDeferred.promise;
    }

    /**
     * @param code
     * Codes 1000, 4500 or above 4500 will be treated as permanent disconnects.
     * @param reason
     */
    disconnect(code: number = 1000, reason?: string) {
        if (this._state === SocketConnectionState.Open)
            this._destroySocket(code, reason).close(code, reason)
        else clearTimeout(this._reconnectTimeoutTicker);
    }

    async reconnect(connectTimeout?: number) {
        this.disconnect();
        return this.connect(connectTimeout);
    }

    private _tryConnect() {
        this.connect().catch(EMPTY_HANDLER);
    }

    private _destroySocket(code: number, reason?: string): WebSocket {
        reason = reason || socketProtocolErrorStatuses[code] || 'Unknown reason';

        this._socket.onopen = EMPTY_HANDLER;
        this._socket.onclose = EMPTY_HANDLER;
        this._socket.onmessage = EMPTY_HANDLER;
        this._socket.onerror = EMPTY_HANDLER;
        this._socket.ondrain = EMPTY_HANDLER;

        clearTimeout(this._connectTimeoutTicker);
        clearTimeout(this._pingTimeoutTicker);
        clearTimeout(this._reconnectTimeoutTicker);

        switch (this._state) {
            case SocketConnectionState.Open:
                this._onDisconnect(code,reason!);
                break;
            case SocketConnectionState.Connecting:
                this._onConnectAbort(code,reason!);
                break;
            case SocketConnectionState.Closed:
                this._transport.emitBadConnection(BadConnectionType.ConnectAbort);
                break;
        }

        this._suspendSubscriptions();

        const socket = this._socket;

        if (this.autoReconnectOptions.active)
            // Reconnect
            // 4000: Server ping timeout
            // 4001: Client pong timeout
            // 1005: close without status
            // 1006 (Abnormal Closure): socket hung up
            if (code === 4000 || code === 4001 || code === 1005) {
                // If there is a ping or pong timeout or socket
                // closes without status, don't wait before trying to reconnect.
                // These could happen if the client wakes up after a period of inactivity and in this case we
                // want to re-establish the connection as soon as possible.
                this._tryReconnect(0)
                // Codes 4500 and above will be treated as permanent disconnects.
                // Socket will not try to auto-reconnect.
            } else if (code !== 1000 && code < 4500) this._tryReconnect();

        return socket;
    }

    private _renewPingTimeout() {
        clearTimeout(this._pingTimeoutTicker);
        this._pingTimeoutTicker = setTimeout(this._boundPingTimeoutReached,this._currentPingTimeout);
    }

    private _boundPingTimeoutReached: Socket['_onPingTimeoutReached'] = this._onPingTimeoutReached.bind(this);
    private _onPingTimeoutReached() {
        this._destroySocket(4000).close(4000);
    }

    private _boundConnectTimeoutReached: Socket['_onConnectTimeoutReached'] = this._onConnectTimeoutReached.bind(this);
    private _onConnectTimeoutReached() {
        this._destroySocket(4007).close(4007);
    }

    private _boundOnSocketOpen: Socket['_onSocketOpen'] = this._onSocketOpen.bind(this);
    private _onSocketOpen() {
        (this.receivers as Writable<Receivers>)[InternalServerTransmits.ConnectionReady] = ([pingInterval,authTokenState,readyData]) => {
            this._currentPingTimeout = pingInterval + 1000;

            if(typeof authTokenState === 'number') {
                this.setAuth(null,null,false)
                if(authTokenState === 2) this._tokenStoreEngine.removeToken();
            }

            this._state = SocketConnectionState.Open;
            (this as Writable<Socket>).reconnectAttempts = 0;
            (this.receivers as Writable<Receivers>)[InternalServerTransmits.ConnectionReady] = EMPTY_HANDLER;
            clearTimeout(this._connectTimeoutTicker);
            this._renewPingTimeout();
            this._transport.emitOpen();
            this._connectDeferred.resolve(readyData);
            this._emit('connect');
            this._processPendingSubscriptions();
        };
    }

    private _boundOnSocketClose: Socket['_onSocketClose'] = this._onSocketClose.bind(this);
    private _onSocketClose(event) {
        this._destroySocket(event.code == null ? 1005 : event.code, event.reason);
    }

    private _boundOnSocketError: Socket['_onSocketError'] = this._onSocketError.bind(this);
    private _onSocketError() {
        if (this._state === SocketConnectionState.Connecting)
            this._destroySocket(1006);
    }

    private _boundOnSocketDrain: Socket['_onSocketDrain'] = this._onSocketDrain.bind(this);
    private _onSocketDrain(backpressure: number) {
        if(backpressure <= this.options.lowSendBackpressureMark)
            this._transport.emitSendBackpressureDrain();
    }

    hasLowSendBackpressure(): boolean {
        return this._socket && this._socket.bufferedAmount <= this.options.lowSendBackpressureMark;
    }

    private _onConnectAbort(code: number, reason: string) {
        this._transport.emitBadConnection(BadConnectionType.ConnectAbort);
        const err = new ConnectAbortError(this._url,code,reason);

        this._connectDeferred.reject(err);
        this._emit('connectAbort',code,reason);

        this._state = SocketConnectionState.Closed;
    }

    private _onDisconnect(code: number, reason: string) {
        this._transport.emitBadConnection(BadConnectionType.Disconnect);
        this._emit('disconnect',code,reason);
        this._state = SocketConnectionState.Closed;
    }

    private _tryReconnect(initialDelay?: number) {
        const exponent = (this as Writable<Socket>).reconnectAttempts++;

        let timeout = (initialDelay == null || exponent > 0) ?
            Math.round(Math.round(this.autoReconnectOptions.initialDelay + this.autoReconnectOptions.randomness * Math.random()) *
                Math.pow(this.autoReconnectOptions.multiplier, this.reconnectAttempts)) : initialDelay;

        if (this.autoReconnectOptions.maxDelay != null && timeout > this.autoReconnectOptions.maxDelay) {
            timeout = this.autoReconnectOptions.maxDelay;
        }

        clearTimeout(this._reconnectTimeoutTicker);
        this._reconnectTimeoutTicker = setTimeout(() => this._tryConnect(), timeout);
    }

    authenticate
        <C extends boolean | undefined = undefined>
        (signedAuthToken: string, options: BatchOption & SendTimeoutOption & CancelableOption<C>):
        C extends true ? CancelablePromise<void> : Promise<void>
    {
        const sendPromise = this.invoke(InternalServerProcedures.Authenticate,signedAuthToken,options);
        const resPromise = sendPromise.then(() => {
            const authToken = extractAuthToken(signedAuthToken);
            if (authToken) this.setAuth(authToken, signedAuthToken,true);
            // noinspection ES6MissingAwait
            this._tokenStoreEngine.saveToken(signedAuthToken);
        });
        return (options.cancelable ? toCancelablePromise(resPromise,
                reason => (sendPromise as CancelablePromise<any>).cancel(reason)) : resPromise) as any;
    }

    async deauthenticate() {
        if(this._state === SocketConnectionState.Open)
            await this.transmit(InternalServerReceivers.Deauthenticate);
        this.setAuth(null,null,true);
        // noinspection ES6MissingAwait
        this._tokenStoreEngine.removeToken();
    }

    isConnected(): boolean {
        return this._state === SocketConnectionState.Open;
    }

    isConnecting(): boolean {
        return this._state === SocketConnectionState.Connecting;
    }

    isClosed(): boolean {
        return this._state === SocketConnectionState.Closed;
    }

    private _createUrl() {
        let port = '';
        if(this.options.port && ((this.options.secure && this.options.port !== 443) ||
            (!this.options.secure && this.options.port !== 80))) port = ':' + this.options.port;
        return `${this.options.secure ? 'wss' : 'ws'}://${this.options.hostname}${port}${this.options.path}`;
    }

    private _createHandshakeUrl(): string {
        return this._stringifiedHandshakeAttachment ?
            this._url + '?' + encodeURIComponent(this._stringifiedHandshakeAttachment) :
            this._url;
    }

    private async _createHandshakeProtocolHeader() {
        const loadedToken = await this._tokenStoreEngine.loadToken();
        return loadedToken ? `${loadedToken}@ziron` : "ziron";
    }

    transmit<C extends boolean | undefined = undefined>
        (receiver: string, data?: any, options: BatchOption & SendTimeoutOption &
            CancelableOption<C> & ComplexTypesOption = {})
        : C extends true ? CancelablePromise<void> : Promise<void>
    {
        if(options.sendTimeout === undefined)
            options.sendTimeout = this.options.transmitSendTimeout;

        const preparedPackage = this._transport.prepareTransmit(receiver,data,options);

        if(this._state !== SocketConnectionState.Open) this._tryConnect();

        if(options.cancelable || options.sendTimeout != null) {
            const sendP = this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch);
            const cp = toCancelablePromise(sendP, () => this._transport.tryCancelPackage(preparedPackage));
            if(options.sendTimeout != null) {
                const timeout = setTimeout(() => {
                    cp.cancel(new TimeoutError('Transmit send timeout reached.','SendTimeout'))
                },options.sendTimeout);
                sendP.finally(() => clearTimeout(timeout))
            }
            return cp as any;
        }
        else return this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch) as any;
    }

    invoke<RDT extends true | false | undefined, C extends boolean | undefined = undefined>
    (procedure: string, data?: any, options: BatchOption & SendTimeoutOption & CancelableOption<C> &
        {returnDataType?: RDT, ackTimeout?: number} & ComplexTypesOption = {})
        : C extends true ? CancelablePromise<RDT extends true ? [any,DataType] : any> : Promise<RDT extends true ? [any,DataType] : any>
    {
        if(options.sendTimeout === undefined)
            options.sendTimeout = this.options.invokeSendTimeout;

        const preparedPackage = this._transport.prepareInvoke(procedure,data,options);

        if(this._state !== SocketConnectionState.Open) this._tryConnect();

        if(options.sendTimeout != null) {
            const sendP = this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch);
            const cp = toCancelablePromise(preparedPackage.promise, () => this._transport.tryCancelPackage(preparedPackage));
            const timeout = setTimeout(() => {
                cp.cancel(new TimeoutError('Invoke send timeout reached.','SendTimeout'))
            },options.sendTimeout);
            sendP.finally(() => clearTimeout(timeout))
            return cp as any;
        }
        else {
            this._transport.sendPreparedPackage(preparedPackage,options.batch);
            return options.cancelable ? toCancelablePromise(preparedPackage.promise, () => this._transport.tryCancelPackage(preparedPackage)) as any :
                preparedPackage.promise as any;
        }
    }

    async subscribe(channel: string, options: BatchOption & SendTimeoutOption = {}) {
        if(this._channelMap[channel] !== ChannelState.Subscribed) {
            await this.invoke(InternalServerProcedures.Subscribe,channel,options);
            this._channelMap[channel] = ChannelState.Subscribed;
            this._chEmitter.emit('subscribe/' + channel);
            this._chEmitter.emit('subscribe', channel);
        }
    }

    private async _trySubscribe(channel: string, batch?: BatchOptionsValue) {
        try {await this.subscribe(channel,{batch});}
        catch(_){}
    }

    /**
     * Unsubscribe from all current channels.
     * @param options
     */
    unsubscribe(options?: BatchOption & SendTimeoutOption)
    /**
     * Unsubscribe from a specific channel.
     * @param channel
     * @param options
     */
    unsubscribe(channel: string, options?: BatchOption & SendTimeoutOption)
    async unsubscribe(p1?: string | BatchOption & SendTimeoutOption,
                      p2?: BatchOption & SendTimeoutOption) {
        if(typeof p1 === 'string') return this._unsubscribe(p1,p2);
        else {
            p1 = p1 || {};
            return Promise.all(Object.keys(this._channelMap)
                .map((channel => this._unsubscribe(channel,p1 as BatchOption & SendTimeoutOption))));
        }
    }

    private async _unsubscribe(channel: string, options: BatchOption & SendTimeoutOption = {}){
        const state = this._channelMap[channel];
        if(state != null) {
            await this.transmit(InternalServerReceivers.Unsubscribe,channel,options);
            delete this._channelMap[channel];
            if(state === ChannelState.Subscribed) {
                this._chEmitter.emit('unsubscribe/' + channel, UnsubscribeReason.Client);
                this._chEmitter.emit('unsubscribe', channel, UnsubscribeReason.Client);
            }
        }
    }

    hasSubscribed(channel: string,includePending: boolean = false): boolean {
        return includePending ? this._channelMap[channel] !== undefined :
            this._channelMap[channel] === ChannelState.Subscribed;
    }

    getSubscriptions(includePending: boolean = false): string[] {
        return includePending ? Object.keys(this._channelMap) : Object.keys(this._channelMap)
            .filter((channel) => this._channelMap[channel] === ChannelState.Subscribed);
    }

    publish<C extends boolean | undefined = undefined, ACK extends boolean | undefined = undefined>
        (channel: string, data?: any, options: BatchOption & SendTimeoutOption & CancelableOption<C> &
            {ack?: boolean} & ComplexTypesOption = {}):
        C extends true ? CancelablePromise<void> : Promise<void>
    {
        if(options.ack) return this.invoke(InternalServerProcedures.Publish,[channel,data],options);
        else return this.transmit(InternalServerReceivers.Publish,[channel,data],options);
    }

    private _processPendingSubscriptions() {
        const channels = Object.keys(this._channelMap);
        for(let i = 0, len = channels.length; i < len; i++) {
            if(this._channelMap[channels[i]] !== ChannelState.Subscribed) {
                // noinspection JSIgnoredPromiseFromCall
                this._trySubscribe(channels[i],true);
            }
        }
        this.flushBuffer();
    }

    private _suspendSubscriptions() {
        const channels = Object.keys(this._channelMap);
        for(let i = 0, len = channels.length, channel: string; i < len; i++) {
            channel = channels[i];
            if(this._channelMap[channel] === ChannelState.Subscribed) {
                this._chEmitter.emit('unsubscribe/' + channel, UnsubscribeReason.BadConnection);
                this._chEmitter.emit('unsubscribe', channel, UnsubscribeReason.BadConnection);
                this._channelMap[channel] = ChannelState.Pending;
            }
        }
    }

    //channel events
    onPublish(abstractListener: (channel: string,data: any,complexDataType: boolean) => any): void
    onPublish(channel: string, listener: (data: any,complexDataType: boolean) => any): void
    onPublish(p1: any, p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.on('publish/' + p1, p2) :
            this._chEmitter.on('publish', p1);
    }

    oncePublish(timeout?: number): Promise<[string,any,boolean]>
    oncePublish(abstractListener: (channel: string,data: any,complexDataType: boolean) => any): void
    oncePublish(channel: string, timeout?: number): Promise<[any,boolean]>
    oncePublish(channel: string, listener: (data: any,complexDataType: boolean) => any): void
    oncePublish(p1?: any,p2?: any): any {
        return typeof p1 === 'string' ? this._chEmitter.once('publish/' + p1, p2) :
            this._chEmitter.once('publish', p1);
    }

    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offPublish(abstractListener?: (channel: string,data: any,complexDataType: boolean) => any): void
    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offPublish(channel: string, listener?: (data: any,complexDataType: boolean) => any): void
    offPublish(p1?: any,p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.off('publish/' + p1, p2) :
            this._chEmitter.off('publish', p1);
    }

    onSubscribe(abstractListener: (channel: string) => any): void
    onSubscribe(channel: string, listener: () => any): void
    onSubscribe(p1: any, p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.on('subscribe/' + p1, p2) :
            this._chEmitter.on('subscribe', p1);
    }

    onceSubscribe(timeout?: number): Promise<[string]>
    onceSubscribe(abstractListener: (channel: string) => any): void
    onceSubscribe(channel: string, timeout?: number): Promise<[]>
    onceSubscribe(channel: string, listener: () => any): void
    onceSubscribe(p1?: any, p2?: any): any {
        return typeof p1 === 'string' ? this._chEmitter.once('subscribe/' + p1, p2) :
            this._chEmitter.once('subscribe', p1);
    }

    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offSubscribe(abstractListener?: (channel: string) => any): void
    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offSubscribe(channel: string, listener?: () => any): void
    offSubscribe(p1?: any,p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.off('subscribe/' + p1, p2) :
            this._chEmitter.off('subscribe', p1);
    }

    onUnsubscribe(abstractListener: (channel: string,reason: UnsubscribeReason,data?: any) => any): void
    onUnsubscribe(channel: string, listener: (reason: UnsubscribeReason,data?: any) => any): void
    onUnsubscribe(p1: any, p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.on('unsubscribe/' + p1, p2) :
            this._chEmitter.on('unsubscribe', p1);
    }

    onceUnsubscribe(timeout?: number): Promise<[string,UnsubscribeReason,any]>
    onceUnsubscribe(abstractListener: (channel: string,reason: UnsubscribeReason,data?: any) => any): void
    onceUnsubscribe(channel: string, timeout?: number): Promise<[UnsubscribeReason,any]>
    onceUnsubscribe(channel: string, listener: (reason: UnsubscribeReason,data?: any) => any): void
    onceUnsubscribe(p1?: any, p2?: any): any {
        return typeof p1 === 'string' ? this._chEmitter.once('unsubscribe/' + p1, p2) :
            this._chEmitter.once('unsubscribe', p1);
    }

    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offUnsubscribe(abstractListener?: (channel: string,reason: UnsubscribeReason,data?: any) => any): void
    /**
     * Notice that when you don't provide a channel name,
     * only abstract listeners are affected.
     */
    offUnsubscribe(channel: string, listener?: (reason: UnsubscribeReason,data?: any) => any): void
    offUnsubscribe(p1?: any,p2?: any) {
        typeof p1 === 'string' ? this._chEmitter.off('unsubscribe/' + p1, p2) :
            this._chEmitter.off('unsubscribe', p1);
    }

    removeAllChannelListener() {
        this._chEmitter.off();
    }
}