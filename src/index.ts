/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import EventEmitter                          from 'emitix';
import Socket, {UnsubscribeReason, ProcedureListener, ReceiverListener} from "./lib/core/Socket";
import TokenStore                            from "./lib/main/tokenStore/TokenStore";
import {createLocalStorageTokenStore}        from "./lib/main/tokenStore/LocalStorageTokenStore";
import SocketOptions                         from "./lib/core/SocketOptions";
import {CancelablePromise, CancellationError, toCancelablePromise} from "./lib/main/utils/CancelablePromise";
import {TimeoutError, Transport}             from "ziron-engine";
import {
    CancelableOption,
    SendTimeoutOption,
    SendTimeoutOptionValue
} from "./lib/main/Options";
import {ConnectAbortError} from "./lib/main/Errors";
import {AuthTokenError} from "ziron-errors";

EventEmitter.onceTimeoutErrorCreator = () => new TimeoutError('Once timeout reached.','OnceListener');
const prepareMultiTransmit = Transport.prepareMultiTransmit;
export * from 'ziron-engine';
export {
    Socket,
    SocketOptions,
    TokenStore,
    createLocalStorageTokenStore,
    toCancelablePromise,
    CancelablePromise,
    CancellationError,
    prepareMultiTransmit,
    UnsubscribeReason,
    ProcedureListener,
    ReceiverListener,
    CancelableOption,
    SendTimeoutOption,
    SendTimeoutOptionValue,
    ConnectAbortError,
    AuthTokenError
}