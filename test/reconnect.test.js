/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella

Tests of the built reconnect (npm test builds first) against a small server of ws and ziron-engine.
 */

const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {WebSocketServer} = require('ws');
const {Transport} = require('ziron-engine');
const {Socket} = require('../dist/index');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(condition, timeout = 3000, message = 'Condition not reached in time.') {
    const start = Date.now();
    while(!condition()) {
        if(Date.now() - start > timeout) throw new Error(message);
        await sleep(5);
    }
}

/**
 * A server that answers the handshake like ziron-server (ConnectionReady)
 * unless ready is false, then the client stays connecting.
 */
async function startServer(port = 0) {
    const wss = new WebSocketServer({port, host: '127.0.0.1'});
    await new Promise(resolve => wss.once('listening', resolve));
    const server = {
        port: wss.address().port,
        connections: 0,
        sockets: new Set(),
        ready: true,
        /** Closes every connection with a close frame of the code. */
        closeAll(code) {for(const ws of server.sockets) ws.close(code);},
        /** Cuts every connection without a close frame (1006 on the client). */
        cutAll() {for(const ws of server.sockets) ws.terminate();},
        stop() {
            server.cutAll();
            return new Promise(resolve => wss.close(() => resolve()));
        }
    };
    wss.on('connection', (ws) => {
        server.connections++;
        server.sockets.add(ws);
        ws.on('close', () => server.sockets.delete(ws));
        const transport = new Transport({send: (msg) => ws.send(msg), cork: (cb) => cb()}, undefined, true);
        ws.on('message', (data, isBinary) => transport.emitMessage(isBinary ?
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.toString()));
        if(server.ready) transport.transmit('#', [60000, 4194304, -1]);
    });
    return server;
}

/** A TCP server that cuts every connection at once: each attempt of a client fails. */
async function startRefuser() {
    const attempts = [];
    const tcp = net.createServer((conn) => {
        attempts.push(Date.now());
        conn.destroy();
    });
    await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
    return {port: tcp.address().port, attempts, stop: () => new Promise(resolve => tcp.close(() => resolve()))};
}

/** A document and a window with the events of a browser, counting their listeners. */
function installBrowserEvents() {
    const document = new EventTarget(), window = new EventTarget();
    document.visibilityState = 'visible';
    const listeners = new Set();
    for(const [name, target] of [['document', document], ['window', window]]) {
        const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
        target.addEventListener = (type, listener) => {listeners.add(name + ':' + type); add(type, listener);};
        target.removeEventListener = (type, listener) => {listeners.delete(name + ':' + type); remove(type, listener);};
    }
    globalThis.document = document;
    globalThis.window = window;
    return {
        document, window, listeners,
        show() {document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));},
        hide() {document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));},
        online() {window.dispatchEvent(new Event('online'));},
        pageshow() {window.dispatchEvent(new Event('pageshow'));}
    };
}

const cleanups = [];
afterEach(async () => {
    while(cleanups.length) await cleanups.pop()();
    delete globalThis.document;
    delete globalThis.window;
});

function createSocket(port, autoReconnect = {}) {
    const socket = new Socket({hostname: '127.0.0.1', port, autoReconnect});
    const changes = [];
    socket.on('nextReconnectChange', (at) => changes.push(at === null ? null : at - Date.now()));
    socket.changes = changes;
    cleanups.push(() => socket.disconnect());
    return socket;
}

async function serve(port) {
    const server = await startServer(port);
    cleanups.push(() => server.stop());
    return server;
}

test('a normal close by the server ends the connection without afterNormalClose', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20]});
    await socket.connect();
    const disconnected = new Promise(resolve => socket.once('disconnect', (code) => resolve(code)));
    server.closeAll(1000);
    assert.equal(await disconnected, 1000);
    await sleep(150);
    assert.equal(server.connections, 1);
    assert.equal(socket.nextReconnectAt, null);
    assert.deepEqual(socket.changes, []);
});

test('a normal close by the server reconnects with afterNormalClose', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20], afterNormalClose: true});
    await socket.connect();
    let plannedOnDisconnect;
    socket.once('disconnect', () => plannedOnDisconnect = socket.nextReconnectAt);
    server.closeAll(1000);
    await waitUntil(() => socket.isConnected() && server.connections === 2);
    //the listener of the disconnect already sees the plan
    assert.equal(typeof plannedOnDisconnect, 'number');
    assert.equal(socket.nextReconnectAt, null);
    assert.equal(socket.changes.length, 2);
    assert.ok(socket.changes[0] > 0 && socket.changes[0] <= 20);
    assert.equal(socket.changes[1], null);
});

test('afterNormalClose does not reconnect after a permanent close (4500 and above)', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20], afterNormalClose: true});
    await socket.connect();
    server.closeAll(4503);
    await waitUntil(() => socket.isClosed());
    await sleep(150);
    assert.equal(server.connections, 1);
    assert.equal(socket.nextReconnectAt, null);
});

test('other closes reconnect as before (1001 on a server shutdown, 1006 on a cut)', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20]});
    await socket.connect();
    server.closeAll(1001);
    await waitUntil(() => socket.isConnected() && server.connections === 2);
    server.cutAll();
    await waitUntil(() => socket.isConnected() && server.connections === 3);
});

test('the delays come one after another and the last one repeats', async () => {
    const refuser = await startRefuser();
    cleanups.push(() => refuser.stop());
    const socket = createSocket(refuser.port, {delays: [30, 60, 90]});
    socket.connect().catch(() => {});
    await waitUntil(() => refuser.attempts.length >= 5, 5000);
    socket.disconnect();
    const planned = socket.changes.filter(change => change !== null).slice(0, 4);
    for(const [i, expected] of [30, 60, 90, 90].entries())
        assert.ok(Math.abs(planned[i] - expected) <= 5, `Delay ${i} is ${planned[i]} ms instead of ${expected} ms.`);
    //each attempt comes when it was planned, not earlier
    for(let i = 1; i < 4; i++) {
        const gap = refuser.attempts[i] - refuser.attempts[i - 1];
        assert.ok(gap >= [30, 60, 90][i - 1] - 5, `Attempt ${i} came after ${gap} ms.`);
    }
});

test('maxDelay caps the delays', async () => {
    const refuser = await startRefuser();
    cleanups.push(() => refuser.stop());
    const socket = createSocket(refuser.port, {delays: [30, 500], maxDelay: 50});
    socket.connect().catch(() => {});
    await waitUntil(() => socket.changes.filter(change => change !== null).length >= 2, 3000);
    const planned = socket.changes.filter(change => change !== null);
    assert.ok(planned[1] <= 50 && planned[1] >= 45, `The second delay is ${planned[1]} ms.`);
});

test('the default delays stay those of ziron (5 s and up to 5 s by chance, times 1.5)', async () => {
    const server = await serve();
    const socket = createSocket(server.port);
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.nextReconnectAt !== null);
    const delay = socket.changes[0];
    assert.ok(delay >= 7490 && delay <= 15000, `The first delay is ${delay} ms.`);
});

test('a ping timeout reconnects at once, then the delays go on from the second one', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [5000, 40]});
    await socket.connect();
    //the deadline passed by the wall clock while the timers stood still
    socket._pingDeadline = Date.now() - 1;
    assert.equal(socket.checkPingTimeout(), true);
    await waitUntil(() => socket.isConnected() && server.connections === 2, 1000);
    assert.equal(socket.changes[0] <= 0, true);
});

test('reconnectNow brings a planned reconnect forward (an environment without browser events)', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [60000]});
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.nextReconnectAt !== null);
    const start = Date.now();
    socket.reconnectNow();
    await waitUntil(() => socket.isConnected(), 1000);
    assert.ok(Date.now() - start < 1000);
    assert.equal(server.connections, 2);
    assert.equal(socket.nextReconnectAt, null);
});

test('reconnectNow does nothing while the connection is fine', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20]});
    await socket.connect();
    socket.reconnectNow();
    await sleep(100);
    assert.ok(socket.isConnected());
    assert.equal(server.connections, 1);
    assert.deepEqual(socket.changes, []);
});

test('reconnectNow drops an open connection that is dead by the wall clock and reconnects at once', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [60000]});
    await socket.connect();
    socket._pingDeadline = Date.now() - 1;
    const code = new Promise(resolve => socket.once('disconnect', resolve));
    socket.reconnectNow();
    assert.equal(await code, 4000);
    await waitUntil(() => socket.isConnected() && server.connections === 2, 1000);
});

test('reconnectNow aborts a connect whose connect timeout passed by the wall clock and tries again at once', async () => {
    const server = await serve();
    server.ready = false;
    const socket = createSocket(server.port, {delays: [60000]});
    const aborted = socket.connect().catch(err => err);
    await waitUntil(() => server.connections === 1);
    socket.reconnectNow();
    await sleep(50);
    assert.ok(socket.isConnecting(), 'A connect in time goes on.');
    socket._connectDeadline = Date.now() - 1;
    server.ready = true;
    socket.reconnectNow();
    assert.equal((await aborted).code, 4007);
    await waitUntil(() => socket.isConnected() && server.connections === 2, 1000);
});

test('the events of a browser bring a planned reconnect forward: visible page, online, pageshow', async () => {
    const browser = installBrowserEvents();
    const server = await serve();
    const socket = createSocket(server.port, {delays: [60000]});
    await socket.connect();
    for(const [event, trigger] of [['visibilitychange', browser.show], ['online', browser.online], ['pageshow', browser.pageshow]]) {
        const connections = server.connections;
        server.cutAll();
        await waitUntil(() => socket.nextReconnectAt !== null);
        trigger();
        await waitUntil(() => socket.isConnected() && server.connections === connections + 1, 1000,
            `No reconnect at once on ${event}.`);
    }
});

test('a hidden page does not bring the reconnect forward', async () => {
    const browser = installBrowserEvents();
    const server = await serve();
    const socket = createSocket(server.port, {delays: [60000]});
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.nextReconnectAt !== null);
    browser.hide();
    browser.online();
    await sleep(150);
    assert.ok(socket.isClosed());
    assert.equal(server.connections, 1);
});

test('only one clock: triggers while a try is under way and sends while lost add no second one', async () => {
    const browser = installBrowserEvents();
    const refuser = await startRefuser();
    cleanups.push(() => refuser.stop());
    const socket = createSocket(refuser.port, {delays: [100]});
    socket.connect().catch(() => {});
    await waitUntil(() => socket.nextReconnectAt !== null);
    for(let i = 0; i < 3; i++) {
        socket.reconnectNow();
        browser.online();
        browser.show();
    }
    socket.transmit('anything').catch(() => {});
    await waitUntil(() => refuser.attempts.length >= 6, 3000);
    socket.disconnect();
    const gaps = refuser.attempts.slice(1).map((at, i) => at - refuser.attempts[i]);
    //the first try, the triggered one, then one every 100 ms
    assert.ok(gaps.slice(1).every(gap => gap >= 90), `Gaps between the attempts: ${gaps.join(', ')} ms.`);
    assert.ok(socket.changes.filter(change => change !== null).every(delay => delay <= 100));
});

test('no attempt after disconnect: no plan, no listeners, reconnectNow and the events do nothing', async () => {
    const browser = installBrowserEvents();
    const server = await serve();
    const socket = createSocket(server.port, {delays: [30], afterNormalClose: true});
    await socket.connect();
    assert.deepEqual([...browser.listeners].sort(), ['document:visibilitychange', 'window:online', 'window:pageshow']);
    server.cutAll();
    await waitUntil(() => socket.nextReconnectAt !== null);
    socket.disconnect();
    assert.equal(socket.nextReconnectAt, null);
    assert.equal(socket.changes.at(-1), null);
    assert.deepEqual([...browser.listeners], []);
    socket.reconnectNow();
    browser.online();
    await sleep(150);
    assert.equal(server.connections, 1);
    assert.ok(socket.isClosed());
});

test('disconnect in a listener of the disconnect cancels the plan before it is told', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [30]});
    await socket.connect();
    socket.once('disconnect', () => socket.disconnect());
    server.cutAll();
    await waitUntil(() => socket.isClosed());
    await sleep(100);
    assert.equal(server.connections, 1);
    assert.deepEqual(socket.changes, []);
});

test('disconnect with any code stops reconnecting, also with a code that would reconnect at once', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20], afterNormalClose: true});
    await socket.connect();
    socket.disconnect(4001, 'Bye');
    await sleep(100);
    assert.equal(server.connections, 1);
    assert.equal(socket.nextReconnectAt, null);
    assert.deepEqual(socket.changes, []);
});

test('afterNormalClose does not reconnect when the client itself failed to connect (1000)', async () => {
    //a hostname that no WebSocket can take
    const socket = createSocket(undefined, {delays: [20], afterNormalClose: true});
    socket.options.hostname = 'bad host';
    socket._url = socket._createUrl();
    const err = await socket.connect().catch(err => err);
    assert.equal(err.code, 1000);
    assert.equal(socket.nextReconnectAt, null);
    assert.deepEqual(socket.changes, []);
});

test('disconnect while connecting stops it and the client does not try again', async () => {
    const server = await serve();
    server.ready = false;
    const socket = createSocket(server.port, {delays: [20]});
    const connecting = socket.connect().catch(err => err);
    await waitUntil(() => server.connections === 1);
    socket.disconnect();
    assert.equal((await connecting).code, 1000);
    await sleep(100);
    assert.equal(server.connections, 1);
    assert.equal(socket.nextReconnectAt, null);
});

test('with autoReconnect inactive there is no plan and no listener after a loss', async () => {
    const browser = installBrowserEvents();
    const server = await serve();
    const socket = createSocket(server.port, {active: false});
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.isClosed());
    assert.equal(socket.nextReconnectAt, null);
    assert.deepEqual([...browser.listeners], []);
    browser.online();
    socket.reconnectNow();
    await sleep(100);
    assert.equal(server.connections, 1);
});

test('without document and window (node) it reconnects by its clock and adds no listener', async () => {
    assert.equal(globalThis.document, undefined);
    const server = await serve();
    const socket = createSocket(server.port, {delays: [20]});
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.isConnected() && server.connections === 2);
    assert.equal(socket._watchingResume, false);
});

test('a first connect that fails is tried again by the clock', async () => {
    const server = await serve();
    const port = server.port;
    await server.stop();
    cleanups.pop();
    const socket = createSocket(port, {delays: [50]});
    await assert.rejects(socket.connect());
    assert.equal(typeof socket.nextReconnectAt, 'number');
    await serve(port);
    await waitUntil(() => socket.isConnected(), 3000);
});

test('explicitly undefined reconnect options keep their defaults', async () => {
    const server = await serve();
    const socket = createSocket(server.port, {delays: undefined, initialDelay: undefined, maxDelay: undefined});
    await socket.connect();
    server.cutAll();
    await waitUntil(() => socket.nextReconnectAt !== null);
    assert.ok(socket.changes[0] >= 7490 && socket.changes[0] <= 15000, `The first delay is ${socket.changes[0]} ms.`);
});
