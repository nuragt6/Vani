const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Increase buffer size to allow large audio file uploads (up to 100MB)
const io = new Server(server, {
    maxHttpBufferSize: 1e8 
});

// 1. Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// 2. Redirect root url (/) straight to room.html
app.get('/', (req, res) => {
    res.redirect('/room.html');
});

// Store rooms, uploaded tracks, and current playback state
const rooms = {};

io.on('connection', (socket) => {
    
    // -- Precise Clock Synchronization --
    socket.on('ping_clock', (clientTime, callback) => {
        callback(clientTime, Date.now());
    });

    // -- Join Room Logic --
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
            
            // LATE JOINER FIX: Send all previously uploaded tracks to the new listener
            if (rooms[roomCode].tracks.length > 0) {
                rooms[roomCode].tracks.forEach(track => {
                    socket.emit('receive_track', track);
                });
            }

            // Give the listener 1.5 seconds to decode the audio, then sync their playback
            if (rooms[roomCode].state) {
                setTimeout(() => {
                    socket.emit('sync_action', rooms[roomCode].state);
                }, 1500); 
            }
        }

        // Update listener counts for everyone in the room
        io.to(roomCode).emit('update_listeners', rooms[roomCode].listeners);
    });

    // -- Audio File Sharing --
    // Save track to memory and forward to listeners
    socket.on('upload_track', (data) => {
        if (rooms[socket.roomCode]) {
            rooms[socket.roomCode].tracks.push(data); 
        }
        socket.to(socket.roomCode).emit('receive_track', data);
    });

    // -- Playback Synchronization --
    // Save playback state (play/pause/seek) and forward to listeners
    socket.on('sync_action', (data) => {
        if (rooms[socket.roomCode]) {
            rooms[socket.roomCode].state = data; 
        }
        socket.to(socket.roomCode).emit('sync_action', data);
    });

    // -- Cleanup on Disconnect --
    socket.on('disconnect', () => {
        if (socket.roomCode && rooms[socket.roomCode]) {
            if (socket.role === 'listener') {
                rooms[socket.roomCode].listeners = rooms[socket.roomCode].listeners.filter(l => l.id !== socket.id);
                io.to(socket.roomCode).emit('update_listeners', rooms[socket.roomCode].listeners);
            } else if (socket.role === 'host') {
                io.to(socket.roomCode).emit('host_left');
                delete rooms[socket.roomCode]; // Clear room memory when host leaves
            }
        }
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎵 VANI Server running on port ${PORT}`);
});
