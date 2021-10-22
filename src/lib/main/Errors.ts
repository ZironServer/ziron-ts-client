/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

export class ConnectAbortError extends Error {
    constructor(readonly url: string,readonly code: number, readonly reason: string) {
        super(`Connect abort to URL: ${url} with reason: ${reason} and code: ${code}.`);
    }
}