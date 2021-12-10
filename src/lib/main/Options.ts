/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

export type SendTimeoutOptionValue = undefined | null | number
export interface SendTimeoutOption {
    /**
     * @description
     * Specifies the send timeout.
     * The send timeout specifies the time limit in that the package should be sent.
     * When the package is not sent in time, it will be rejected with a TimeoutError.
     * The sending of a package could be delayed whenever the source (socket) is not connected.
     * In this case, the package is pushed into a buffer.
     * When the connection is established again, the buffer is flushed.
     * If the send timeout is null, the package will never be rejected and
     * waits until the connection is open in case of an unconnected source.
     */
    sendTimeout?: SendTimeoutOptionValue
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