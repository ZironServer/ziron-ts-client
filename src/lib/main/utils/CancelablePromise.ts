/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {Writable} from "./Types";

export class CancellationError extends Error {
    constructor(message: string = 'The promise was cancelled.') {
        super(message);
    }
}

export interface CancelablePromise<T> extends Promise<T> {
    readonly canceled: boolean
    cancel(reason?: any): boolean
}

export function toCancelablePromise<T>(promise: Promise<T>,canceler: (reason?: any) => boolean): CancelablePromise<T> {
    let promiseDone: boolean = false;
    let promiseRej: (reason: any) => void;
    const p = new Promise((res,rej) => {
        promise.then((result) => {
            promiseDone = true;
            res(result);
        }).catch((err) => {
            promiseDone = true;
            rej(err);
        });
        promiseRej = rej;
    }) as CancelablePromise<T>;
    (p as Writable<CancelablePromise<T>>).canceled = false;
    p.cancel = (reason: any = new CancellationError()) => {
        if(promiseDone || p.canceled) return p.canceled;
        if(canceler(reason)) {
            (p as Writable<CancelablePromise<T>>).canceled = true;
            promiseRej(reason);
            return true;
        }
        return false;
    }
    return p;
}