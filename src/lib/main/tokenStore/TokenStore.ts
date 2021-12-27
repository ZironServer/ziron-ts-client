/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

/**
 * @description
 * Interface for implementing your own token store.
 * Notice that you should not manually change
 * the stored singed token from the store.
 */
export default interface TokenStore {
    /**
     * @description
     * The function that is called to save the signed token.
     * @param signedToken
     */
    saveToken(signedToken: string): Promise<void> | void;

    /**
     * @description
     * The function that loads the signed token.
     * If no signed token is stored you can return null.
     */
    loadToken(): Promise<string | null> | string | null

    /**
     * @description
     * The function that is called to remove the signed token.
     */
    removeToken(): Promise<void> | void
}