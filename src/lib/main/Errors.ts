/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

export class ConnectAbortError extends Error {
    public readonly code: number;
    public readonly reason: string;
    constructor(code: number, reason: string) {
        super('Connect abort -> ' + reason);
        this.code = code;
        this.reason = reason;
    }
}