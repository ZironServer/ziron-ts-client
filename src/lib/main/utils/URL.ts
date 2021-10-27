/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

export function preprocessPath(path: string): string {
    // add pre slash
    if (path !== '' && path[0] !== '/') path = `/${path}`;
    // remove trailing slash
    return path[path.length - 1] === '/' ? path.substring(0,path.length - 1) : path;
}