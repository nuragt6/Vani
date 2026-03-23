
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // Allow large audio files
});

app.use(express.static(path.join(__dirname, 'public')));

// Store rooms, tracks, and playback state
const rooms = {};

io.on('connection', (socket) => {
    // Precise Clock Synchronization
    socket.on('ping_clock', (clientTime, callback) => {
        callback(clientTime, Date.now());
    });

    // Join Room Logic
    socket.on('join_room', ({ roomCode, role, user }) => {
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.role = role;

        // Initialize room if it doesn't exist
        if (!rooms[roomCode]) {
            rooms[roomCode] = { host: null, listeners: [], tracks: [], state: null };
        }

        if (role === 'host') {
            rooms[roomCode].host = socket.id;
        } else {
            rooms[roomCode].listeners.push({ id: socket.id, ...user });

            // 🚨 FIX: Send all previously uploaded tracks to the late-joining listener!
            if (rooms[roomCode].tracks.length > 0) {
                rooms[roomCode].tracks.forEach(track => {
                    socket.emit('receive_track', track);
                });
            }

            // 🚨 FIX: Give the listener 1.5 seconds to decode the audio, then sync their playback!
            if (rooms[roomCode].state) {
                setTimeout(() => {
                    socket.emit('sync_action', rooms[roomCode].state);
                }, 1500);
            }
        }

        // Update listener counts for everyone
        io.to(roomCode).emit('update_listeners', rooms[roomCode].listeners);
    });

    // Save track and forward to listeners
    socket.on('upload_track', (data) => {
        if (rooms[socket.roomCode]) {
            rooms[socket.roomCode].tracks.push(data); // Save for late joiners
        }
        socket.to(socket.roomCode).emit('receive_track', data);
    });

    // Save playback state and forward to listeners
    socket.on('sync_action', (data) => {
        if (rooms[socket.roomCode]) {
            rooms[socket.roomCode].state = data; // Save if host paused or played
        }
        socket.to(socket.roomCode).emit('sync_action', data);
    });

    // Cleanup when someone leaves
    socket.on('disconnect', () => {
        if (socket.roomCode && rooms[socket.roomCode]) {
            if (socket.role === 'listener') {
                rooms[socket.roomCode].listeners = rooms[socket.roomCode].listeners.filter(l => l.id !== socket.id);
                io.to(socket.roomCode).emit('update_listeners', rooms[socket.roomCode].listeners);
            } else if (socket.role === 'host') {
                io.to(socket.roomCode).emit('host_left');
                delete rooms[socket.roomCode];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎵 Audio Sync Server running on http://localhost:${PORT}`);
});
