'use strict';
// Client-side Socket.IO helper — role-aware room joining + event re-emission

let _socket = null;

function initSocket(token) {
  if (_socket) return _socket;
  _socket = io({ auth: { token } });

  _socket.on('connect', () => console.log('🔌 Socket connected:', _socket.id));
  _socket.on('disconnect', () => console.log('🔌 Socket disconnected'));
  _socket.on('connect_error', (err) => console.error('Socket error:', err.message));

  return _socket;
}

function getSocket() { return _socket; }
