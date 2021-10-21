/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {Buffer} from 'buffer/';

export function extractAuthToken(signedAuthToken: string): any | null {
    const encodedToken = (signedAuthToken || '').split('.')[1];
    if(encodedToken != null) {
        try {return JSON.parse(Buffer.from(encodedToken, 'base64').toString('utf8'))}
        catch (e) {}
    }
    return null;
}