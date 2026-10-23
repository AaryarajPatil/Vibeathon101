'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, authorize } = require('../auth');
const { handleBreakdown } = require('../logic/breakdown');
const { findAlternativeShelter, rerouteDelivery } = require('../logic/rerouting');

const router = express.Router();

// GET /api/deliveries — RIDER sees own; ADMIN sees all; DONOR sees own donations; SHELTER sees own incoming
router.get('/', authenticate, (req, res) => {
  let rows;
  if (req.user.role === 'ADMIN') {
    rows = db.prepare(`
      SELECT del.*, u.name as rider_name,
             b.quantity, b.shelter_id,
             d.aid_type, d.expiry_at, d.donor_id,
             s.address as shelter_address, u_s.name as shelter_name,
             p.status as payment_status, p.amount as paid_amount, p.id as payment_id
      FROM deliveries del
      JOIN riders r ON del.rider_id = r.id
      JOIN users u ON r.id = u.id
      JOIN batches b ON del.batch_id = b.id
      JOIN donations d ON b.donation_id = d.id
      LEFT JOIN shelters s ON del.dest_shelter_id = s.id
      LEFT JOIN users u_s ON s.id = u_s.id
      LEFT JOIN payments p ON p.delivery_id = del.id
      ORDER BY del.created_at DESC
    `).all();
  } else if (req.user.role === 'RIDER') {
    rows = db.prepare(`
      SELECT del.*, b.quantity, b.shelter_id, d.aid_type, d.expiry_at,
             s.address as shelter_address, u_s.name as shelter_name,
             d.pickup_address, d.pickup_lat, d.pickup_lng
      FROM deliveries del
      JOIN batches b ON del.batch_id = b.id
      JOIN donations d ON b.donation_id = d.id
      LEFT JOIN shelters s ON del.dest_shelter_id = s.id
      LEFT JOIN users u_s ON s.id = u_s.id
      WHERE del.rider_id = ?
      ORDER BY del.created_at DESC
    `).all(req.user.id);
  } else if (req.user.role === 'DONOR') {
    rows = db.prepare(`
      SELECT del.*, u.name as rider_name,
             b.quantity, b.shelter_id,
             d.aid_type, d.expiry_at, d.donor_id,
             s.address as shelter_address, u_s.name as shelter_name,
             p.status as payment_status, p.amount as paid_amount, p.id as payment_id
      FROM deliveries del
      JOIN riders r ON del.rider_id = r.id
      JOIN users u ON r.id = u.id
      JOIN batches b ON del.batch_id = b.id
      JOIN donations d ON b.donation_id = d.id
      LEFT JOIN shelters s ON del.dest_shelter_id = s.id
      LEFT JOIN users u_s ON s.id = u_s.id
      LEFT JOIN payments p ON p.delivery_id = del.id
      WHERE d.donor_id = ?
      ORDER BY del.created_at DESC
    `).all(req.user.id);
  } else if (req.user.role === 'SHELTER') {
    rows = db.prepare(`
      SELECT del.*, u.name as rider_name,
             b.quantity, b.shelter_id,
             d.aid_type, d.expiry_at, d.donor_id,
             s.address as shelter_address, u_s.name as shelter_name,
             d.pickup_address, d.notes,
             u_don.name as donor_name
      FROM deliveries del
      JOIN riders r ON del.rider_id = r.id
      JOIN users u ON r.id = u.id
      JOIN batches b ON del.batch_id = b.id
      JOIN donations d ON b.donation_id = d.id
      LEFT JOIN shelters s ON del.dest_shelter_id = s.id
      LEFT JOIN users u_s ON s.id = u_s.id
      LEFT JOIN users u_don ON d.donor_id = u_don.id
      WHERE del.dest_shelter_id = ?
      ORDER BY del.created_at DESC
    `).all(req.user.id);
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(rows);
});

// GET /api/deliveries/:id
router.get('/:id', authenticate, (req, res) => {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  const segments = db.prepare('SELECT * FROM delivery_segments WHERE delivery_id=? ORDER BY segment_order').all(delivery.id);
  res.json({ ...delivery, segments });
});

// PUT /api/deliveries/:id/pickup
router.put('/:id/pickup', authenticate, authorize('RIDER'), (req, res) => {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (delivery.rider_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (delivery.status !== 'PENDING') return res.status(400).json({ error: 'Delivery not in PENDING state' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE deliveries SET status='PICKED_UP', picked_up_at=? WHERE id=?").run(now, delivery.id);
  db.prepare("UPDATE batches SET status='IN_TRANSIT' WHERE id=?").run(delivery.batch_id);
  db.prepare("UPDATE donations SET status='IN_TRANSIT' WHERE id=(SELECT donation_id FROM batches WHERE id=?)").run(delivery.batch_id);

  const io = req.app.get('io');
  if (io) {
    const don = db.prepare('SELECT donor_id FROM donations WHERE id=(SELECT donation_id FROM batches WHERE id=?)').get(delivery.batch_id);
    io.emit('delivery:status_changed', { deliveryId: delivery.id, status: 'PICKED_UP', riderId: req.user.id });
    if (don) io.to(`donor:${don.donor_id}`).emit('delivery:status_changed', { deliveryId: delivery.id, status: 'PICKED_UP' });
    if (delivery.dest_shelter_id) io.to(`shelter:${delivery.dest_shelter_id}`).emit('delivery:status_changed', { deliveryId: delivery.id, status: 'PICKED_UP' });
  }

  res.json({ success: true, status: 'PICKED_UP' });
});

// PUT /api/deliveries/:id/deliver
router.put('/:id/deliver', authenticate, authorize('RIDER'), (req, res) => {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (delivery.rider_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE deliveries SET status='DELIVERED', delivered_at=?, route_pct_completed=1.0 WHERE id=?").run(now, delivery.id);
  db.prepare("UPDATE batches SET status='DELIVERED' WHERE id=?").run(delivery.batch_id);
  db.prepare("UPDATE donations SET status='DELIVERED' WHERE id=(SELECT donation_id FROM batches WHERE id=?)").run(delivery.batch_id);
  db.prepare("UPDATE riders SET status='AVAILABLE' WHERE id=?").run(req.user.id);

  // Mark rider's segment complete if it exists
  db.prepare(`
    UPDATE delivery_segments SET status='COMPLETED', completed_at=?
    WHERE delivery_id=? AND rider_id=? AND status='PENDING'
  `).run(now, delivery.id, req.user.id);

  // Reduce shelter demand
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(delivery.batch_id);
  const donation = db.prepare('SELECT * FROM donations WHERE id=?').get(batch.donation_id);
  const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };
  const field = fieldMap[donation.aid_type];
  if (field && delivery.dest_shelter_id) {
    db.prepare(`UPDATE shelters SET ${field} = MAX(0, ${field} - ?), updated_at=unixepoch() WHERE id=?`)
      .run(batch.quantity, delivery.dest_shelter_id);
  }

  const io = req.app.get('io');
  if (io) {
    io.emit('delivery:status_changed', { deliveryId: delivery.id, status: 'DELIVERED', riderId: req.user.id });
    if (donation) io.to(`donor:${donation.donor_id}`).emit('delivery:status_changed', { deliveryId: delivery.id, status: 'DELIVERED' });
    if (delivery.dest_shelter_id) io.to(`shelter:${delivery.dest_shelter_id}`).emit('delivery:status_changed', { deliveryId: delivery.id, status: 'DELIVERED' });
  }

  res.json({ success: true, status: 'DELIVERED' });
});

// PUT /api/deliveries/:id/breakdown
router.put('/:id/breakdown', authenticate, authorize('RIDER'), (req, res) => {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (delivery.rider_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const result = handleBreakdown(delivery, lat, lng);

  const io = req.app.get('io');
  if (io) {
    if (result.success && result.rescueRider) {
      io.to(`rider:${result.rescueRider.id}`).emit('breakdown:rescue_assigned', {
        deliveryId: delivery.id,
        breakdownLat: lat, breakdownLng: lng,
        pctOfRoute: result.pctB,
        message: `Pickup needed at breakdown location. You will complete ${Math.round(result.pctB * 100)}% of delivery.`
      });
    }
    io.to('admin').emit('alert:critical', {
      type: 'BREAKDOWN',
      message: `Rider breakdown on delivery ${delivery.id}`,
      deliveryId: delivery.id,
      rescueRiderId: result.rescueRider?.id,
      pctA: result.pctA, pctB: result.pctB
    });
    io.emit('delivery:status_changed', { deliveryId: delivery.id, status: 'IN_TRANSIT' });
  }

  res.json(result);
});

// PUT /api/deliveries/:id/reroute — ADMIN only
router.put('/:id/reroute', authenticate, authorize('ADMIN'), (req, res) => {
  const { new_shelter_id } = req.body;
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Not found' });

  let targetShelterId = new_shelter_id;
  if (!targetShelterId) {
    const alt = findAlternativeShelter(delivery, delivery.dest_shelter_id);
    if (!alt) return res.status(404).json({ error: 'No alternative shelter found' });
    targetShelterId = alt.id;
  }

  const result = rerouteDelivery(delivery.id, targetShelterId);
  if (result.error) return res.status(400).json(result);

  const io = req.app.get('io');
  if (io) {
    io.to(`rider:${delivery.rider_id}`).emit('delivery:rerouted', {
      deliveryId: delivery.id,
      newShelterId: targetShelterId,
      newShelter: result.newShelter
    });
    io.emit('delivery:status_changed', { deliveryId: delivery.id, status: 'REROUTED' });
    io.to('admin').emit('delivery:rerouted', { deliveryId: delivery.id, newShelterId: targetShelterId });
  }

  res.json(result);
});

module.exports = router;
