/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {ClientOptions as WSClientOptions} from "ws";
import TokenStore from "../main/tokenStore/TokenStore";
import {WINDOW_DEFINED} from "../main/utils/Constants";

export interface AutoReconnectOptions {
    /**
     * @default true
     */
    active?: boolean,
    initialDelay?: number,
    randomness?: number,
    multiplier?: number,
    maxDelay?: number | null
}

export default interface SocketOptions {
    hostname?: string,
    port?: number,
    secure?: boolean,
    path?: string,
    autoReconnect?: AutoReconnectOptions,
    autoSubscribeOnConnect?: boolean,
    connectTimeout?: number,
    ackTimeout?: number,
    transmitSendTimeout?: null | number;
    invokeSendTimeout?: null | number;
    handshakeAttachment?: any,
    wsOptions?: WSClientOptions,
    /**
     * Specifies the token store that is used to save/load and remove the token.
     * Internal the client will also store the token in a variable
     * independent of what store is used.
     * The stored token will be loaded whenever the client wants to connect again.
     * The load tries to load the token with the store if no store is provided
     * or the load fails it will load the token from the in-memory variable.
     * The client already provides a local storage token store that
     * uses the local storage of a browser.
     * This store helps to reload the signed token when the client
     * opens a new Tab or reloads the site in the browser.
     * @default undefined
     */
    tokenStore?: TokenStore | null
}

export const DEFAULT_HOSTNAME = WINDOW_DEFINED && window.location && window.location.hostname || 'localhost';
export const DEFAULT_SECURE = WINDOW_DEFINED && window.location && window.location.protocol ? (window.location.protocol === 'https:') : false;
export function getDefaultPort(secure: boolean) {
    return (WINDOW_DEFINED && window.location && window.location.port) ? parseInt(window.location.port) : secure ? 443: 80;
}