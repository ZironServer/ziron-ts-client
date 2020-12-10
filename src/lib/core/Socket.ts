/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import SocketOptions, {AutoReconnectOptions, DEFAULT_HOSTNAME, DEFAULT_SECURE, getDefaultPort} from "./SocketOptions";
import TokenStoreEngine from "../main/tokenStore/TokenStoreEngine";
import {createWebSocket, WebSocket} from './WebSocket';
import {InternalServerProcedures, InternalServerReceivers, InternalServerTransmits} from "zation-core-events";
import {
    BadConnectionType,
    DataType,
    InvokeListener,
    PreparePackageOptions,
    TimeoutError,
    TransmitListener,
    Transport
} from "ziron-engine";
import {Writable} from "../main/utils/Types";
import {EMPTY_HANDLER} from "../main/utils/Constants";
import Deferred from "../main/utils/Deferred";
import {socketProtocolErrorStatuses} from "zation-core-errors";
import {ConnectAbortError} from "../main/Errors";
import EventEmitter from "emitix";
import {CancelablePromise, toCancelablePromise} from "../main/utils/CancelablePromise";
import {extractAuthToken} from "../main/utils/AuthToken";

type LocalEventEmitter = EventEmitter<{
    'error': [Error],
    'warning': [Error],
    'connectAbort': [ConnectAbortError],
    'connect': [],
    'disconnect': [number,string],
    'authTokenChange': [object | null,object | null]
}>;

export const enum SocketConnectionState {
    Open,
    Connecting,
    Closed
}

type ReceiverListener = (data: any, type: DataType) => void | Promise<void>;
type ProcedureListener = (data: any,end: (data?: any) => void,reject: (err?: any) => void, type: DataType) => void | Promise<void>

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

    private _currentPingTimeout: number = 200000;
    private _pingTimeoutTicker: NodeJS.Timeout;
    private _connectTimeoutTicker: NodeJS.Timeout;
    private _reconnectTimeoutTicker: NodeJS.Timeout;
    private _connectDeferred: Deferred<void>;

    private readonly _tokenStoreEngine: TokenStoreEngine;

    public readonly signedAuthToken: string | null = null;
    public readonly authToken: any | null = null;
    public readonly authenticated: boolean = false;
    private setAuth<PT extends null | object>(authToken: PT, signedAuthToken: PT extends null ? null : string) {
        const oldAuthToken = this.authToken;
        (this as Writable<Socket>).authToken = authToken;
        (this as Writable<Socket>).signedAuthToken = signedAuthToken;
        (this as Writable<Socket>).authenticated = authToken != null;
        if(oldAuthToken !== authToken)
            this._emit('authTokenChange',authToken,oldAuthToken);
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
                this.setAuth(authToken, signedAuthToken);
                // noinspection JSIgnoredPromiseFromCall
                this._tokenStoreEngine.saveToken(signedAuthToken);
            }
        },
        [InternalServerTransmits.RemoveAuthToken]: () => {
            this.setAuth(null,null);
            // noinspection JSIgnoredPromiseFromCall
            this._tokenStoreEngine.removeToken();
        },
        [InternalServerTransmits.KickOut]: EMPTY_HANDLER,
        [InternalServerTransmits.Publish]: EMPTY_HANDLER
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

    constructor(options: SocketOptions = {}) {
        this.options = {
            hostname: DEFAULT_HOSTNAME,
            port: getDefaultPort(options.secure ?? DEFAULT_SECURE),
            secure: DEFAULT_SECURE,
            path: '/ziron',
            connectTimeout: 20000,
            ackTimeout: 7000,
            invokeSendTimeout: 3000,
            transmitSendTimeout: null,
            autoReconnect: {},
            autoResubscribe: true,
            handshakeAttachment: undefined,
            wsOptions: {},
            tokenStore: null
        };
        Object.assign(this.options,options);
        if(!this.options.path.startsWith('/')) this.options.path = ('/' + this.options.path);

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
        this._transport.onPing = () => {
            this._renewPingTimeout();
            this._transport.sendPong();
        };
        this._transport.ackTimeout = this.options.ackTimeout;

        this._onMessageHandler = event => this._transport.emitMessage(event.data);
    }

    private _onInvoke(event: string,data: any,end: (data?: any) => void,reject: (err?: any) => void, type: DataType) {
        if(this.procedures[event]) return this.procedures[event]!(data,end,reject,type);
        this.onUnknownInvoke(event,data,end,reject,type);
    }

    private _onTransmit(event: string,data: any,type: DataType) {
        if(this.receivers[event]) return this.receivers[event]!(data,type);
        this.onUnknownTransmit(event,data,type);
    }

    async connect(timeout?: number): Promise<void> {
        if(this._state === SocketConnectionState.Closed) {
            this._state = SocketConnectionState.Connecting;

            clearTimeout(this._reconnectTimeoutTicker);

            const connectDeferred = new Deferred<void>();
            this._connectDeferred = connectDeferred;

            try {
                const handshakeUrl = await this._createHandshakeUrl();

                this._connectTimeoutTicker = setTimeout(this._boundConnectTimeoutReached,
                    timeout || this.options.connectTimeout);

                const socket = createWebSocket(handshakeUrl,this.options.wsOptions);
                this._socket = socket;

                socket.binaryType = 'arraybuffer';
                socket.onmessage = this._onMessageHandler;
                socket.onclose = this._boundOnSocketClose;
                socket.onerror = this._boundOnSocketError;
                socket.onopen = this._boundOnSocketOpen;
                this._transport.send = socket.send.bind(socket);
            }
            catch (err) {connectDeferred.reject(err)}
        }
        return this._connectDeferred.promise;
    }

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

        const socket = this._socket;

        if (this.autoReconnectOptions.active)
            // Reconnect
            // on server ping timeout (4000)
            // or on client pong timeout (4001)
            // or on close without status (1005)
            // or on handshake failure (4003)
            // or on handshake rejection (4008)
            // or on socket hung up (1006)
            if (code === 4000 || code === 4001 || code === 1005) {
                // If there is a ping or pong timeout or socket closes without
                // status, don't wait before trying to reconnect.
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
        (this.receivers as Writable<Receivers>)[InternalServerTransmits.ConnectionReady] = ([pingInterval,authTokenState]) => {
            this._currentPingTimeout = pingInterval + 1000;

            if(typeof authTokenState === 'number') {
                this.setAuth(null,null)
                if(authTokenState === 2) this._tokenStoreEngine.removeToken();
            }

            this._state = SocketConnectionState.Open;
            (this as Writable<Socket>).reconnectAttempts = 0;
            (this.receivers as Writable<Receivers>)[InternalServerTransmits.ConnectionReady] = EMPTY_HANDLER;
            clearTimeout(this._connectTimeoutTicker);
            this._renewPingTimeout();
            this._transport.emitOpen();
            this._connectDeferred.resolve();
            this._emit('connect');
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

    private _onConnectAbort(code: number, reason: string) {
        this._transport.emitBadConnection(BadConnectionType.ConnectAbort);
        const err = new ConnectAbortError(code,reason);

        this._connectDeferred.reject(err);
        this._emit('connectAbort',err);

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

    async authenticate(signedAuthToken: string) {
        await this.invoke(InternalServerProcedures.Authenticate,signedAuthToken);
        const authToken = extractAuthToken(signedAuthToken);
        if (authToken) this.setAuth(authToken, signedAuthToken);
        // noinspection ES6MissingAwait
        this._tokenStoreEngine.saveToken(signedAuthToken);
    }

    async deauthenticate() {
        if(this._state === SocketConnectionState.Open)
            await this.transmit(InternalServerReceivers.Deauthenticate);
        this.setAuth(null,null);
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

    private async _createHandshakeUrl() {
        const loadToken = await this._tokenStoreEngine.loadToken();
        const props: string[] = [];
        if(loadToken) props.push(`"t":"${loadToken}"`)
        if(this._stringifiedHandshakeAttachment) props.push(`"a":${this._stringifiedHandshakeAttachment}`);
        return this._url + '?' + encodeURIComponent(`{${props.join(',')}}`);
    }

    transmit<C extends boolean | undefined = undefined>
        (event: string, data?: any, options: {batch?: number | true, sendTimeout?: number | null, cancelable?: C} & PreparePackageOptions = {})
        : C extends true ? CancelablePromise<void> : Promise<void>
    {
        if(options.sendTimeout === undefined)
            options.sendTimeout = this.options.transmitSendTimeout;

        const preparedPackage = this._transport.prepareTransmit(event,data,options);

        if(this._state !== SocketConnectionState.Open) this._tryConnect();

        if(options.cancelable || options.sendTimeout != null) {
            const sendP = this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch);
            const cp = toCancelablePromise(sendP, () => this._transport.tryCancelPackage(preparedPackage));
            if(options.sendTimeout != null) {
                const timeout = setTimeout(() => {
                    cp.cancel(new TimeoutError('Transmit send timeout reached.','SendTimeout'))
                });
                sendP.finally(() => clearTimeout(timeout))
            }
            return cp as any;
        }
        else return this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch) as any;
    }

    invoke<RDT extends true | false | undefined, C extends boolean | undefined = undefined>
    (event: string, data?: any, options: {batch?: number | true, sendTimeout?: number | null, cancelable?: C, returnDataType?: RDT, ackTimeout?: number} & PreparePackageOptions = {})
        : C extends true ? CancelablePromise<RDT extends true ? [any,DataType] : any> : Promise<RDT extends true ? [any,DataType] : any>
    {
        if(options.sendTimeout === undefined)
            options.sendTimeout = this.options.invokeSendTimeout;

        const preparedPackage = this._transport.prepareInvoke(event,data,options);

        if(this._state !== SocketConnectionState.Open) this._tryConnect();

        if(options.sendTimeout != null) {
            const sendP = this._transport.sendPreparedPackageWithPromise(preparedPackage,options.batch);
            const cp = toCancelablePromise(preparedPackage.promise, () => this._transport.tryCancelPackage(preparedPackage));
            const timeout = setTimeout(() => {
                cp.cancel(new TimeoutError('Invoke send timeout reached.','SendTimeout'))
            });
            sendP.finally(() => clearTimeout(timeout))
            return cp as any;
        }
        else {
            this._transport.sendPreparedPackage(preparedPackage,options.batch);
            return options.cancelable ? toCancelablePromise(preparedPackage.promise, () => this._transport.tryCancelPackage(preparedPackage)) as any :
                preparedPackage.promise as any;
        }
    }

}