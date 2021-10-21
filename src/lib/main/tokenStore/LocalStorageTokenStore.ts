/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import TokenStore from "./TokenStore";

function isLocalStorageEnabled() {
    let err;
    try {
        // Some browsers will throw an error here if localStorage is disabled.
        window.localStorage;
        // Safari, in Private Browsing Mode, looks like it supports localStorage but all calls to setItem
        // throw QuotaExceededError. We're going to detect this and avoid hard to debug edge cases.
        window.localStorage.setItem('__scLocalStorageTest', '1');
        window.localStorage.removeItem('__scLocalStorageTest');
    } catch (e) {err = e;}
    return !err;
}
const localStorageEnabled = isLocalStorageEnabled();
const tokenNamePrefix = 'ZationClientToken.';

export function createLocalStorageTokenStore(key: string): TokenStore {
    return {
        saveToken(signedToken: string): Promise<void> | void {
            if(localStorageEnabled && window.localStorage){
                window.localStorage.setItem(tokenNamePrefix + key, signedToken);
            }
        },
        loadToken(): Promise<string | null> | string | null {
            if(localStorageEnabled && window.localStorage){
                return window.localStorage.getItem(tokenNamePrefix + key) || null;
            }
            return null;
        },
        removeToken(): Promise<void> | void {
            if(localStorageEnabled && window.localStorage){
                window.localStorage.removeItem(tokenNamePrefix + key);
            }
        }
    };
}