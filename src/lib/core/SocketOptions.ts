/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {ClientOptions as WSClientOptions} from "ws";
import TokenStore from "../main/tokenStore/TokenStore";
import {WINDOW_DEFINED} from "../main/utils/Constants";
import {TransportOptions} from "ziron-engine";

export interface AutoReconnectOptions {
    /**
     * @description
     * Defines if the client should try to reconnect to the server when the connection is lost.
     * Notice that the client will automatically resubscribe all previous channels.
     * @default true
     */
    active?: boolean,
    /**
     * @description
     * Initial delay in milliseconds.
     * @default 5000
     */
    initialDelay?: number,
    /**
     * @description
     * Randomness in milliseconds.
     * @default 5000
     */
    randomness?: number,
    /**
     * @description
     * Miltiplier (decimal)
     * @default 1.5
     */
    multiplier?: number,
    /**
     * @description
     * Max delay in milliseconds.
     * @default 60000
     */
    maxDelay?: number | null
}

export default interface SocketOptions {
    /**
     * @description
     * The hostname where the client should connect to.
     * @default The current host (from the URL) or localhost.
     */
    hostname?: string,
    /**
     * @description
     * The port where the client should connect to.
     * @default Port from the current URL if it fails it is 80 or 443 if the secure option is true.
     */
    port?: number,
    /**
     * @description
     * Indicates if the client should use TLS (SSL) to create a secure connection to the server.
     * @default Is true if the current protocol of the URL is https.
     */
    secure?: boolean,
    /**
     * @description
     * The URL path where the server processes ws handshakes.
     * Notice multiple slashes at the end are not supported and will be removed.
     * @default '/'.
     */
    path?: string,
    /**
     * @description
     * Specifies options for the auto reconnect feature.
     * @default
     * {
     *  active: true,
     *  initialDelay: 5000,
     *  multiplier: 1.5,
     *  randomness: 5000,
     *  maxDelay: 60000
     * }
     */
    autoReconnect?: AutoReconnectOptions,
    /**
     * @description
     * Indicates if channels should be resubscribed automatically after a reconnect.
     */
    autoResubscribe?: boolean,
    /**
     * @description
     * Specifies the default connect timeout.
     * @default 20000
     */
    connectTimeout?: number,
    /**
     * @description
     * Defines the default timeout in milliseconds for
     * receiving the response of an invoke.
     * Notice that an individual ack timeout can be specified for
     * an invoke that overrides this option value.
     * @default 7000
     */
    ackTimeout?: number;
    /**
     * @description
     * Specifies the default transmit send timeout.
     * The send timeout specifies the time limit in that the package should be sent.
     * If the timeout is reached, the package will be rejected.
     * When the connection is not open the package is pushed into the buffer.
     * Soon as possible, the buffer is flushed. If the send timeout is null,
     * the package will never be rejected and waits until the connection is open.
     * @default null
     */
    transmitSendTimeout?: null | number;
    /**
     * @description
     * Specifies the default invoke send timeout.
     * The send timeout specifies the time limit in that the package should be sent.
     * If the timeout is reached, the package will be rejected.
     * When the connection is not open the package is pushed into the buffer.
     * Soon as possible, the buffer is flushed. If the send timeout is null,
     * the package will never be rejected and waits until the connection is open.
     * @default 3000
     */
    invokeSendTimeout?: null | number;
    /**
     * @description
     * This attachment will be sent to the server when
     * the client is creating his connection and
     * can be accessed from the server-side.
     * @default undefined
     */
    handshakeAttachment?: any,
    /**
     * @description
     * Passes options to the underlying WS module socket.
     * Be careful this module is only used when the Browser WebSocket is not available.
     */
    wsOptions?: WSClientOptions,
    /**
     * @description
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
    /**
     * @description
     * Advanced option.
     * Defines a byte mark to evaluate if the socket
     * write-buffer backpressure is low.
     * Write streams will pause when the backpressure
     * is not low and are waiting for low pressure.
     * @default 209715 Bytes
     */
    lowSendBackpressureMark?: number
    /**
     * @description
     * The maximum package buffer size in bytes.
     * Whenever a package should be sent in an unconnected state or
     * with a batch time, it is pushed to the buffer.
     * When a new package would exceed the buffer size,
     * the buffer will be flushed automatically.
     * When it is not possible to flush the buffer duo to a not open state,
     * an InsufficientBufferSizeError will be thrown.
     * Notice that the UTF-8 byte size of string packages is only estimated.
     * @default Number.POSITIVE_INFINITY
     */
    maxPackageBufferSize?: number;
    /**
     * @description
     * Advanced option.
     * Defines the timeout in milliseconds for receiving
     * the referenced binary content packet of a text packet.
     * @default 10000
     */
    binaryContentPacketTimeout?: number;
    /**
     * @description
     * Advanced option.
     * This option defines how many
     * streams are allowed in a package.
     * @default 20
     */
    streamsPerPackageLimit?: number;
    /**
     * @description
     * Advanced option.
     * This option species if chunks
     * of streams can contain streams.
     * @default false
     */
    chunksCanContainStreams?: boolean;
}

export const DEFAULT_HOSTNAME = WINDOW_DEFINED && window.location && window.location.hostname || 'localhost';
export const DEFAULT_SECURE = WINDOW_DEFINED && window.location && window.location.protocol ? (window.location.protocol === 'https:') : false;
export function getDefaultPort(secure: boolean) {
    return (WINDOW_DEFINED && window.location && window.location.port) ? parseInt(window.location.port) : secure ? 443: 80;
}