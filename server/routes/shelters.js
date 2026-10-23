'use strict';
const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../auth');

const router = express.Router();

// GET /api/shelters  — public: all active shelters with requirements
router.get('/', (req, res) => {
  const shelters = db.prepare(`
    SELECT s.*, u.name, u.email, u.phone
    FROM shelters s JOIN users u ON s.id = u.id
    WHERE s.is_active = 1
    ORDER BY u.name
  `).all();
  res.json(shelters);
});

// GET /api/shelters/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT s.*, u.name, u.email, u.phone
    FROM shelters s JOIN users u ON s.id = u.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Shelter not found' });
  res.json(row);
});

// PUT /api/shelters/:id/requirements — SHELTER owner or ADMIN
router.put('/:id/requirements', authenticate, (req, res) => {
  const { id } = req.params;
  if (req.user.role !== 'ADMIN' && req.user.id !== id)
    return res.status(403).json({ error: 'Forbidden' });

  const { capacity, food_required, medical_required, kit_required, compatibility_notes, address, lat, lng } = req.body;

  const shelter = db.prepare('SELECT * FROM shelters WHERE id = ?').get(id);
  if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

  db.prepare(`
    UPDATE shelters SET
      capacity            = COALESCE(?, capacity),
      food_required       = COALESCE(?, food_required),
      medical_required    = COALESCE(?, medical_required),
      kit_required        = COALESCE(?, kit_required),
      compatibility_notes = COALESCE(?, compatibility_notes),
      address             = COALESCE(?, address),
      lat                 = COALESCE(?, lat),
      lng                 = COALESCE(?, lng),
      updated_at          = unixepoch()
    WHERE id = ?
  `).run(
    capacity ?? null, food_required ?? null, medical_required ?? null,
    kit_required ?? null, compatibility_notes ?? null,
    address ?? null, lat ?? null, lng ?? null, id
  );

  const updated = db.prepare('SELECT s.*, u.name FROM shelters s JOIN users u ON s.id=u.id WHERE s.id=?').get(id);

  // Emit real-time update
  const io = req.app.get('io');
  if (io) io.to('admin').emit('shelter:demand_updated', { shelterId: id, requirements: updated });

  res.json(updated);
});

// PUT /api/shelters/:id/status
router.put('/:id/status', authenticate, (req, res) => {
  const { id } = req.params;
  if (req.user.role !== 'ADMIN' && req.user.id !== id)
    return res.status(403).json({ error: 'Forbidden' });

  const { is_active } = req.body;
  if (typeof is_active === 'undefined')
    return res.status(400).json({ error: 'is_active required' });

  db.prepare('UPDATE shelters SET is_active = ?, updated_at = unixepoch() WHERE id = ?')
    .run(is_active ? 1 : 0, id);

  const io = req.app.get('io');
  if (io) {
    io.to('admin').emit('shelter:status_changed', { shelterId: id, is_active });
    if (!is_active) {
      // Trigger rerouting check for in-transit deliveries to this shelter
      io.to('admin').emit('alert:critical', {
        type: 'SHELTER_CLOSED',
        message: `Shelter ${id} just went offline — check active deliveries`,
        shelterId: id
      });
    }
  }

  res.json({ id, is_active: !!is_active });
});

// GET /api/shelters/:id/incoming — list incoming batches and deliveries for shelter
router.get('/:id/incoming', authenticate, (req, res) => {
  const { id } = req.params;
  if (req.user.role !== 'ADMIN' && req.user.id !== id)
    return res.status(403).json({ error: 'Forbidden' });

  const incoming = db.prepare(`
    SELECT b.id as batch_id, b.quantity, b.status as batch_status, b.created_at,
           d.id as donation_id, d.aid_type, d.expiry_at, d.notes, d.pickup_address,
           u_don.name as donor_name,
           del.id as delivery_id, del.status as delivery_status, del.picked_up_at, del.delivered_at,
           u_rid.name as rider_name
    FROM batches b
    JOIN donations d ON b.donation_id = d.id
    JOIN users u_don ON d.donor_id = u_don.id
    LEFT JOIN deliveries del ON del.batch_id = b.id
    LEFT JOIN riders r ON del.rider_id = r.id
    LEFT JOIN users u_rid ON r.id = u_rid.id
    WHERE b.shelter_id = ?
    ORDER BY b.created_at DESC
  `).all(id);

  res.json(incoming);
});

module.exports = router;

