/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {Writable} from "./Types";

export default class Deferred<T = any> {
    public readonly fulfilled: boolean = false;
    public readonly resolve: (data: T) => void;
    public readonly reject: (err: any) => void;
    public readonly promise: Promise<T> = new Promise<T>((res,rej) => {
        (this as Writable<Deferred<T>>).resolve = (result) => {
            (this as Writable<Deferred<T>>).fulfilled = true;
            res(result);
        };
        (this as Writable<Deferred<T>>).reject = (err) => {
            (this as Writable<Deferred<T>>).fulfilled = true;
            rej(err);
        };
    })
}