/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import TokenStore from "./TokenStore";

export default class TokenStoreEngine {

    private readonly _tokenStore?: TokenStore | null;

    constructor(tokenStore?: TokenStore | null) {
        this._tokenStore = tokenStore;
    }

    async saveToken(token: string) {
        if(this._tokenStore){
            try {await this._tokenStore.saveToken(token);}
            catch (_) {}
        }
    }

    async loadToken(): Promise<string | null> {
        if(this._tokenStore){
            try {
                const token = await this._tokenStore.loadToken();
                if(token) return token;
            }
            catch (_) {}
        }
        return null;
    }

    async removeToken() {
        if(this._tokenStore){
            try {await this._tokenStore.removeToken();}
            catch (_) {}
        }
    }
}