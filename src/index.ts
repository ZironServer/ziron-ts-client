/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import EventEmitter                          from 'emitix';
import Socket, {UnsubscribeReason, ProcedureListener, ReceiverListener} from "./lib/core/Socket";
import TokenStore                            from "./lib/main/tokenStore/TokenStore";
import {createLocalStorageTokenStore}        from "./lib/main/tokenStore/LocalStorageTokenStore";
import SocketOptions                         from "./lib/core/SocketOptions";
import {CancelablePromise, CancellationError, toCancelablePromise} from "./lib/main/utils/CancelablePromise";
import {TimeoutError, Transport}             from "ziron-engine";

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
    ReceiverListener
}