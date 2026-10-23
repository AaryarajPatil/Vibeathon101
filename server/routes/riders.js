'use strict';
const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../auth');

const router = express.Router();

// GET /api/riders — ADMIN only
router.get('/', authenticate, authorize('ADMIN'), (req, res) => {
  const riders = db.prepare(`
    SELECT r.*, u.name, u.email, u.phone
    FROM riders r JOIN users u ON r.id = u.id
    ORDER BY r.status, u.name
  `).all();
  res.json(riders);
});

// PUT /api/riders/:id/location — RIDER only (own)
router.put('/:id/location', authenticate, authorize('RIDER'), (req, res) => {
  if (req.user.id !== req.params.id)
    return res.status(403).json({ error: 'Forbidden' });
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined)
    return res.status(400).json({ error: 'lat and lng required' });

  db.prepare('UPDATE riders SET lat=?, lng=?, updated_at=unixepoch() WHERE id=?')
    .run(lat, lng, req.params.id);

  // Broadcast to admin
  const io = req.app.get('io');
  if (io) io.to('admin').emit('rider:location_updated', { riderId: req.params.id, lat, lng });

  res.json({ success: true });
});

// PUT /api/riders/:id/status — RIDER (own) or ADMIN
router.put('/:id/status', authenticate, (req, res) => {
  const { id } = req.params;
  if (req.user.role !== 'ADMIN' && req.user.id !== id)
    return res.status(403).json({ error: 'Forbidden' });

  const { status, capacity_kg, vehicle_type } = req.body;
  const allowed = ['AVAILABLE', 'BUSY', 'OFFLINE', 'BREAKDOWN'];
  if (status && !allowed.includes(status))
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  db.prepare(`
    UPDATE riders SET
      status       = COALESCE(?, status),
      capacity_kg  = COALESCE(?, capacity_kg),
      vehicle_type = COALESCE(?, vehicle_type),
      updated_at   = unixepoch()
    WHERE id = ?
  `).run(status || null, capacity_kg ?? null, vehicle_type || null, id);

  const io = req.app.get('io');
  if (io) io.to('admin').emit('rider:status_changed', { riderId: id, status });

  res.json({ success: true, id, status });
});

module.exports = router;
