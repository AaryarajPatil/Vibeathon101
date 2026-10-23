'use strict';
require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'aidsync_secret';
const EXPIRES = process.env.JWT_EXPIRES_IN || '24h';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Express middleware — attaches req.user on success
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Role guard factory — usage: authorize('ADMIN','SHELTER')
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(', ')}` });
    next();
  };
}

module.exports = { signToken, verifyToken, authenticate, authorize };
