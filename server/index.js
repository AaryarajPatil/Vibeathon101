'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const db = require('./db'); // initialises DB + runs migrations

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Make io accessible in route handlers via req.app.get('io')
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// API Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/shelters',  require('./routes/shelters'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/riders',    require('./routes/riders'));
app.use('/api/batches',   require('./routes/batches'));
app.use('/api/deliveries',require('./routes/deliveries'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/admin',     require('./routes/admin'));

// Serve SPA pages
app.get('/donor',   (_, res) => res.sendFile(path.join(__dirname, '..', 'client', 'pages', 'donor.html')));
app.get('/rider',   (_, res) => res.sendFile(path.join(__dirname, '..', 'client', 'pages', 'rider.html')));
app.get('/shelter', (_, res) => res.sendFile(path.join(__dirname, '..', 'client', 'pages', 'shelter.html')));
app.get('/admin',   (_, res) => res.sendFile(path.join(__dirname, '..', 'client', 'pages', 'admin.html')));

// API 404
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));

// Socket.IO handlers
require('./socket')(io);

// Scheduler (ghost reservations + expiry warnings)
require('./scheduler')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 AidSync running at http://localhost:${PORT}`);
  console.log(`   Roles: /donor | /rider | /shelter | /admin`);
});
