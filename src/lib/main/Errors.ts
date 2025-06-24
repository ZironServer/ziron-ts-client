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

export function stringifyError(err: any): string | undefined {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message; 
    try {return String(err)} 
    catch {return undefined;}
}