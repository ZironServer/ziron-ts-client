/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import EventEmitter from 'emitix';
import Socket from "./lib/core/Socket";
import TokenStore from "./lib/main/tokenStore/TokenStore";
import {createLocalStorageTokenStore} from "./lib/main/tokenStore/LocalStorageTokenStore";
import SocketOptions from "./lib/core/SocketOptions";
import {TimeoutError} from "ziron-engine";
import {CancelablePromise,CancellationError} from "./lib/main/utils/CancelablePromise";

EventEmitter.onceTimeoutErrorCreator = () => new TimeoutError('Once timeout reached.','OnceListener');

export {
    Socket,
    SocketOptions,
    TokenStore,
    createLocalStorageTokenStore,
    CancelablePromise,
    CancellationError
}