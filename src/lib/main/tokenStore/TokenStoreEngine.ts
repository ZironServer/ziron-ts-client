/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import TokenStore from "./TokenStore";

export default class TokenStoreEngine {

    private readonly _tokenStore?: TokenStore | null;

    constructor(tokenStore?: TokenStore | null) {
        this._tokenStore = tokenStore;
    }

    private _internalStorage: string | null = null;

    async saveToken(token: string) {
        this._internalStorage = token;
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
        return this._internalStorage;
    }

    async removeToken() {
        this._internalStorage = null;
        if(this._tokenStore){
            try {await this._tokenStore.removeToken();}
            catch (_) {}
        }
    }
}