// Spaceship Game - WebSocket Relay Server
// Run with: node server.js
// Requires: npm install ws

const WebSocket = require('ws');
const PROTOCOL_VERSION = 1;
const PORT = 8080;

const wss = new WebSocket.Server({ port: PORT });

// Game rooms: { roomCode: { host: ws, client: ws, gameWidth, gameHeight } }
const rooms = new Map();

console.log(`Spaceship relay server running on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('New connection');
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(ws, msg);
        } catch (e) {
            console.error('Invalid message:', e);
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'HOST':
            handleHost(ws, msg);
            break;
        case 'JOIN':
            handleJoin(ws, msg);
            break;
        case 'HELLO':
            handleHello(ws, msg);
            break;
        case 'SCREEN_SIZE':
        case 'SHIP_IMAGES':
        case 'WELCOME':
        case 'MOVE':
        case 'SPAWN':
        case 'DELETE':
        case 'FIRE':
        case 'DAMAGE':
        case 'COLLISION':
            // Relay to other player
            relay(ws, msg);
            break;
        default:
            console.log('Unknown message type:', msg.type);
    }
}

function handleHost(ws, msg) {
    // Generate 4-digit room code
    const roomCode = String(Math.floor(1000 + Math.random() * 9000));
    
    rooms.set(roomCode, {
        host: ws,
        client: null,
        hostScreen: { w: msg.screenW, h: msg.screenH },
        clientScreen: null,
        gameWidth: null,
        gameHeight: null
    });
    
    ws.roomCode = roomCode;
    ws.isHost = true;
    
    console.log(`Room ${roomCode} created`);
    
    ws.send(JSON.stringify({
        type: 'HOSTED',
        roomCode: roomCode,
        version: PROTOCOL_VERSION
    }));
}

function handleJoin(ws, msg) {
    const room = rooms.get(msg.roomCode);
    
    if (!room) {
        ws.send(JSON.stringify({ type: 'REJECT', reason: 'Room not found' }));
        return;
    }
    
    if (room.client) {
        ws.send(JSON.stringify({ type: 'REJECT', reason: 'Room full' }));
        return;
    }
    
    room.client = ws;
    room.clientScreen = { w: msg.screenW, h: msg.screenH };
    
    // Calculate game dimensions (smaller of two screens)
    room.gameWidth = Math.min(room.hostScreen.w, room.clientScreen.w);
    room.gameHeight = Math.min(room.hostScreen.h, room.clientScreen.h);
    
    ws.roomCode = msg.roomCode;
    ws.isHost = false;
    
    console.log(`Client joined room ${msg.roomCode}`);
    console.log(`Game size: ${room.gameWidth} x ${room.gameHeight}`);
    
    // Notify both players of game dimensions
    const sizeMsg = JSON.stringify({
        type: 'SCREEN_SIZE',
        gameW: room.gameWidth,
        gameH: room.gameHeight
    });
    
    room.host.send(sizeMsg);
    room.client.send(sizeMsg);
    
    // Tell host that client joined
    room.host.send(JSON.stringify({
        type: 'CLIENT_JOINED',
        version: PROTOCOL_VERSION
    }));
    
    // Tell client they're connected
    ws.send(JSON.stringify({
        type: 'JOINED',
        version: PROTOCOL_VERSION
    }));
}

function handleHello(ws, msg) {
    // Forward to host (for ship image exchange)
    relay(ws, msg);
}

function relay(ws, msg) {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    const target = ws.isHost ? room.client : room.host;
    if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify(msg));
    }
}

function handleDisconnect(ws) {
    if (!ws.roomCode) return;
    
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    console.log(`Player disconnected from room ${ws.roomCode}`);
    
    // Notify other player
    const other = ws.isHost ? room.client : room.host;
    if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: 'DISCONNECT' }));
    }
    
    // Clean up room
    rooms.delete(ws.roomCode);
}

// Heartbeat to detect dead connections
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});
