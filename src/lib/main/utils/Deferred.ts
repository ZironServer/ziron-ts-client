/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {Writable} from "./Types";

export default class Deferred<T = any> {
    public readonly resolve: (data: T) => void;
    public readonly reject: (err: any) => void;
    public readonly promise: Promise<T> = new Promise<T>((res,rej) => {
        (this as Writable<Deferred<T>>).resolve = res;
        (this as Writable<Deferred<T>>).reject = rej;
    })
}