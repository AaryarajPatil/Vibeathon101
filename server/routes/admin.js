'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, authorize } = require('../auth');
const { runMatchAll } = require('../logic/matching');

const router = express.Router();

// GET /api/admin/dashboard
router.get('/dashboard', authenticate, authorize('ADMIN'), (req, res) => {
  const stats = {
    donors:       db.prepare("SELECT COUNT(*) as c FROM users WHERE role='DONOR'").get()?.c || 0,
    riders:       db.prepare("SELECT COUNT(*) as c FROM users WHERE role='RIDER'").get()?.c || 0,
    shelters:     db.prepare("SELECT COUNT(*) as c FROM shelters WHERE is_active=1").get()?.c || 0,
    donations:    db.prepare("SELECT COUNT(*) as c FROM donations").get()?.c || 0,
    deliveries_active: db.prepare("SELECT COUNT(*) as c FROM deliveries WHERE status NOT IN ('DELIVERED','FAILED')").get()?.c || 0,
    deliveries_done:   db.prepare("SELECT COUNT(*) as c FROM deliveries WHERE status='DELIVERED'").get()?.c || 0,
    pending_donations: db.prepare("SELECT COUNT(*) as c FROM donations WHERE status='PENDING'").get()?.c || 0,
    available_riders:  db.prepare("SELECT COUNT(*) as c FROM riders WHERE status='AVAILABLE'").get()?.c || 0,
    open_alerts:       db.prepare("SELECT COUNT(*) as c FROM alerts WHERE resolved_at IS NULL").get()?.c || 0,
  };
  res.json(stats);
});

// GET /api/admin/alerts
router.get('/alerts', authenticate, authorize('ADMIN'), (req, res) => {
  const alerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100').all();
  res.json(alerts);
});

// PUT /api/admin/alerts/:id/resolve
router.put('/alerts/:id/resolve', authenticate, authorize('ADMIN'), (req, res) => {
  db.prepare('UPDATE alerts SET resolved_at=unixepoch() WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/match — trigger smart matching
router.post('/match', authenticate, authorize('ADMIN'), (req, res) => {
  const results = runMatchAll();
  res.json({ matched: results.length, results });
});

// GET /api/match/suggestions/:donationId
router.get('/match/suggestions/:donationId', authenticate, authorize('ADMIN'), (req, res) => {
  const { matchDonation } = require('../logic/matching');
  const donation = db.prepare('SELECT * FROM donations WHERE id=?').get(req.params.donationId);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  // Preview without writing to DB — use a dry-run approach by checking score
  const { haversine } = require('../logic/matching');
  const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };
  const shelters = db.prepare('SELECT s.*, u.name FROM shelters s JOIN users u ON s.id=u.id WHERE s.is_active=1').all();
  const nowSec = Math.floor(Date.now() / 1000);
  const AVG_SPEED = 25;

  const suggestions = shelters
    .map(s => {
      const required = s[fieldMap[donation.aid_type]] || 0;
      if (required <= 0) return null;
      const dist = haversine(donation.pickup_lat, donation.pickup_lng, s.lat, s.lng);
      const travelSec = (dist / AVG_SPEED) * 3600;
      const expiryBuffer = donation.expiry_at - nowSec - travelSec;
      return {
        shelter_id: s.id, shelter_name: s.name, address: s.address,
        required, dist_km: Math.round(dist * 10) / 10,
        eta_minutes: Math.round(travelSec / 60),
        expiry_buffer_minutes: Math.round(expiryBuffer / 60),
        feasible: expiryBuffer > 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.feasible ? 1 : 0) - (a.feasible ? 1 : 0) || a.dist_km - b.dist_km);

  res.json(suggestions);
});

module.exports = router;
