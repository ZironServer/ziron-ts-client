/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import SocketOptions, {AutoReconnectOptions} from "./SocketOptions";
import TokenStoreEngine from "../main/tokenStore/TokenStoreEngine";
import {createWebSocket, WebSocket} from './WebSocket';
import {InternalServerProcedures, InternalServerReceivers, InternalServerTransmits} from "zation-core-events";
import {
    BadConnectionType,
    Transport,
    DataType,
    InvokeListener,
    TransmitListener,
    PreparePackageOptions,
    TimeoutError
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

    private readonly options: Required<SocketOptions> = {
        hostname: 'localhost',
        port: 3000,
        secure: false,
        path: '/zation',
        connectTimeout: 20000,
        ackTimeout: 7000,
        invokeSendTimeout: 3000,
        transmitSendTimeout: null,
        autoReconnect: {},
        autoSubscribeOnConnect: true,
        handshakeAttachment: undefined,
        wsOptions: {},
        tokenStore: null
    };

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
    private _connectDeferred: Deferred<void>;

    private readonly _tokenStoreEngine: TokenStoreEngine;
    public readonly procedures: Procedures = {};
    /**
     * @description
     * Will be called whenever no corresponding Procedure was found.
     * Can be overridden.
     */
    public onUnknownInvoke: InvokeListener = () => {};

    public readonly receivers: Receivers = {
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
        Object.assign(this.options,options);
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

}