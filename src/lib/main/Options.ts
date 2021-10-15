/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

export type SendTimeoutOptionValue = undefined | null | number
export interface SendTimeoutOption {
    /**
     * @description
     * Specifies the send timeout.
     * The send timeout specifies the time limit in that the package should be sent.
     * When the package is not sent in time, it will be rejected with a TimeoutError.
     * The sending of a package could be delayed whenever the socket is not connected.
     * In this case, the package is pushed into a buffer.
     * When the connection is established again, the buffer is flushed.
     * If the send timeout is null, the package will never be rejected and
     * waits until the connection is open in case of an unconnected source.
     */
    sendTimeout?: SendTimeoutOptionValue
}

export type BatchOptionsValue = number | true | null | undefined;
export interface BatchOption {
    /**
     * @description
     * Specifies the batch option.
     * This option helps to batch multiple packages to save performance.
     * When using the batch option, the package will be pushed into the buffer.
     * When the buffer gets flushed, all packages from the buffer will be compressed sequence safe.
     * With a number, you can specify the maximum time a package should wait in the buffer.
     * Whenever the lowest time of all packages in the buffer is reached, the buffer gets flushed.
     * A true value will push the package in the buffer but without any time limit.
     * So the flushing depends on other packages or on manually flushing the buffer.
     * Undefined, null, or 0 will not batch the package when the client is connected and sends it directly.
     */
    batch?: BatchOptionsValue
}

export interface CancelableOption<C extends boolean | undefined> {
    /**
     * @description
     * When this option is activated, the method returns a CancelablePromise instead of a normal promise.
     * This special promise gives you the possibility to cancel the sending of a package.
     * But be careful; only when the package is in the buffer and not already sent it is possible to cancel it.
     * The return value of the cancel method indicates if the cancellation was successful.
     */
    cancelable?: C
}