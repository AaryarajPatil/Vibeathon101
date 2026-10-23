'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, authorize } = require('../auth');

const router = express.Router();

// GET /api/donations — DONOR sees own; ADMIN sees all
router.get('/', authenticate, (req, res) => {
  let rows;
  if (req.user.role === 'ADMIN') {
    rows = db.prepare(`
      SELECT d.*, u.name as donor_name FROM donations d
      JOIN users u ON d.donor_id = u.id ORDER BY d.created_at DESC
    `).all();
  } else if (req.user.role === 'DONOR') {
    rows = db.prepare(`
      SELECT d.*, u.name as donor_name FROM donations d
      JOIN users u ON d.donor_id = u.id
      WHERE d.donor_id = ? ORDER BY d.created_at DESC
    `).all(req.user.id);
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(rows);
});

// GET /api/donations/:id
router.get('/:id', authenticate, (req, res) => {
  const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  if (req.user.role === 'DONOR' && donation.donor_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  const batches = db.prepare('SELECT * FROM batches WHERE donation_id = ?').all(donation.id);
  res.json({ ...donation, batches });
});

// POST /api/donations — DONOR only
router.post('/', authenticate, authorize('DONOR'), (req, res) => {
  const { aid_type, quantity, expiry_minutes, notes, pickup_address, pickup_lat, pickup_lng, shelter_id } = req.body;
  if (!aid_type || !quantity)
    return res.status(400).json({ error: 'aid_type and quantity are required' });
  if (!['FOOD', 'MEDICAL', 'KIT'].includes(aid_type))
    return res.status(400).json({ error: 'aid_type must be FOOD, MEDICAL, or KIT' });

  // --- Cap enforcement against shelter requirement ---
  if (shelter_id) {
    const shelter = db.prepare('SELECT * FROM shelters WHERE id = ?').get(shelter_id);
    if (!shelter) return res.status(404).json({ error: 'Shelter not found' });

    const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };
    const reqField = fieldMap[aid_type];
    const shelterRequired = shelter[reqField] || 0;

    // How much has already been committed (pending/in-transit batches for this shelter+type)
    const committed = db.prepare(`
      SELECT COALESCE(SUM(b.quantity), 0) as total
      FROM batches b
      JOIN donations don ON b.donation_id = don.id
      WHERE b.shelter_id = ? AND don.aid_type = ?
        AND b.status NOT IN ('EXPIRED','DELIVERED')
    `).get(shelter_id, aid_type);

    const remaining = shelterRequired - (committed?.total || 0);
    if (remaining <= 0)
      return res.status(400).json({ error: 'Shelter requirement already met. More than requirement leads to wastage.', remaining: 0 });
    if (quantity > remaining)
      return res.status(400).json({
        error: `Quantity exceeds remaining shelter need (${remaining} ${req.body.unit || 'kg'}). More than requirement leads to wastage.`,
        remaining
      });
  }

  const id = uuidv4();
  const mins = expiry_minutes || 120;
  const expiry_at = Math.floor(Date.now() / 1000) + mins * 60;

  db.prepare(`
    INSERT INTO donations(id,donor_id,aid_type,quantity,unit,expiry_minutes,expiry_at,notes,pickup_address,pickup_lat,pickup_lng)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, req.user.id, aid_type, quantity, req.body.unit || 'kg',
    mins, expiry_at, notes || '', pickup_address || '',
    pickup_lat || 12.9716, pickup_lng || 77.5946
  );

  const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(id);
  res.status(201).json(donation);
});

// PUT /api/donations/:id/cancel
router.put('/:id/cancel', authenticate, authorize('DONOR'), (req, res) => {
  const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!donation) return res.status(404).json({ error: 'Not found' });
  if (donation.donor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!['PENDING', 'MATCHED'].includes(donation.status))
    return res.status(400).json({ error: `Cannot cancel donation in status: ${donation.status}` });

  db.prepare("UPDATE donations SET status='CANCELLED' WHERE id=?").run(donation.id);
  db.prepare("UPDATE batches SET status='EXPIRED' WHERE donation_id=? AND status='AVAILABLE'").run(donation.id);
  res.json({ success: true });
});

module.exports = router;
