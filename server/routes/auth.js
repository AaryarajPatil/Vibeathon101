'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { signToken, authenticate } = require('../auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'name, email, password and role are required' });
  const validRoles = ['DONOR', 'RIDER', 'SHELTER', 'ADMIN'];
  if (!validRoles.includes(role))
    return res.status(400).json({ error: `role must be one of ${validRoles.join(', ')}` });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users(id,name,email,password,role,phone) VALUES(?,?,?,?,?,?)')
    .run(id, name, email, hash, role, phone || null);

  // Create role-specific profile row
  if (role === 'SHELTER') {
    db.prepare('INSERT OR IGNORE INTO shelters(id) VALUES(?)').run(id);
  } else if (role === 'RIDER') {
    db.prepare('INSERT OR IGNORE INTO riders(id) VALUES(?)').run(id);
  }

  const token = signToken({ id, name, email, role });
  res.status(201).json({ token, user: { id, name, email, role } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ id: user.id, name: user.name, email: user.email, role: user.role });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,phone,created_at FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;
