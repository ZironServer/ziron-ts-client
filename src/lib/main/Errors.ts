/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
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