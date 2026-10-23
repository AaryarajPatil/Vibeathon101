'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, authorize } = require('../auth');

const router = express.Router();
const RESERVATION_TTL = parseInt(process.env.RESERVATION_TTL_SECONDS || '300', 10);

// GET /api/batches/available — RIDER sees all available batches
router.get('/available', authenticate, authorize('RIDER'), (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, d.aid_type, d.expiry_at, d.pickup_lat, d.pickup_lng, d.pickup_address,
           d.notes, d.quantity as total_quantity,
           s.address as shelter_address, s.lat as shelter_lat, s.lng as shelter_lng,
           u_donor.name as donor_name, u_shelter.name as shelter_name
    FROM batches b
    JOIN donations d ON b.donation_id = d.id
    LEFT JOIN shelters s ON b.shelter_id = s.id
    LEFT JOIN users u_donor ON d.donor_id = u_donor.id
    LEFT JOIN users u_shelter ON s.id = u_shelter.id
    WHERE b.status = 'AVAILABLE' AND d.expiry_at > unixepoch()
    ORDER BY d.expiry_at ASC
  `).all();
  res.json(batches);
});

// POST /api/batches/:id/reserve — ghost reservation
router.post('/:id/reserve', authenticate, authorize('RIDER'), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'AVAILABLE')
    return res.status(409).json({ error: `Batch is not available (status: ${batch.status})` });

  const rider = db.prepare('SELECT * FROM riders WHERE id=?').get(req.user.id);
  if (!rider || rider.status !== 'AVAILABLE')
    return res.status(409).json({ error: 'Rider is not available' });

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RESERVATION_TTL;
  const resId = uuidv4();

  db.prepare('INSERT INTO reservations(id,batch_id,rider_id,reserved_at,expires_at) VALUES(?,?,?,?,?)')
    .run(resId, batch.id, req.user.id, now, expiresAt);
  db.prepare("UPDATE batches SET status='RESERVED' WHERE id=?").run(batch.id);
  db.prepare("UPDATE riders SET status='BUSY' WHERE id=?").run(req.user.id);

  res.status(201).json({ reservation_id: resId, expires_at: expiresAt, ttl_seconds: RESERVATION_TTL });
});

// POST /api/batches/:id/confirm — confirm reservation → create delivery
router.post('/:id/confirm', authenticate, authorize('RIDER'), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'RESERVED')
    return res.status(409).json({ error: 'No active reservation for this batch' });

  const reservation = db.prepare(`
    SELECT * FROM reservations
    WHERE batch_id=? AND rider_id=? AND status='PENDING' AND expires_at > unixepoch()
  `).get(batch.id, req.user.id);

  if (!reservation)
    return res.status(409).json({ error: 'Reservation not found or already expired' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE reservations SET status='CONFIRMED', confirmed_at=? WHERE id=?").run(now, reservation.id);
  db.prepare("UPDATE batches SET status='ASSIGNED' WHERE id=?").run(batch.id);

  const donation = db.prepare('SELECT * FROM donations WHERE id=?').get(batch.donation_id);
  const deliveryId = uuidv4();
  db.prepare(`
    INSERT INTO deliveries(id,batch_id,rider_id,origin_lat,origin_lng,dest_shelter_id,status)
    VALUES(?,?,?,?,?,?,'PENDING')
  `).run(deliveryId, batch.id, req.user.id,
    donation.pickup_lat, donation.pickup_lng, batch.shelter_id);

  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(deliveryId);

  // Emit to admin
  const io = req.app.get('io');
  if (io) io.to('admin').emit('delivery:status_changed', { deliveryId, status: 'PENDING', riderId: req.user.id });

  res.status(201).json(delivery);
});

// PUT /api/batches/:id/release
router.put('/:id/release', authenticate, (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const reservation = db.prepare(`
    SELECT * FROM reservations WHERE batch_id=? AND status='PENDING'
  `).get(batch.id);

  if (reservation) {
    db.prepare("UPDATE reservations SET status='CANCELLED' WHERE id=?").run(reservation.id);
    db.prepare("UPDATE riders SET status='AVAILABLE' WHERE id=?").run(reservation.rider_id);
  }
  db.prepare("UPDATE batches SET status='AVAILABLE' WHERE id=?").run(batch.id);
  res.json({ success: true });
});

module.exports = router;
