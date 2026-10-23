'use strict';
const db = require('../db');

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const AVG_RIDER_SPEED_KMH = 25; // conservative urban speed
const W1 = 0.5; // demand ratio weight
const W2 = 0.3; // travel time weight
const W3 = 0.2; // expiry buffer weight

function scorePair(donation, shelter) {
  const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };
  const required = shelter[fieldMap[donation.aid_type]] || 0;
  if (required <= 0) return -Infinity;

  const nowSec = Math.floor(Date.now() / 1000);
  const dist = haversine(donation.pickup_lat, donation.pickup_lng, shelter.lat, shelter.lng);
  const travelSec = (dist / AVG_RIDER_SPEED_KMH) * 3600;
  const expiryBuffer = donation.expiry_at - nowSec - travelSec;

  if (expiryBuffer <= 0) return -Infinity; // would expire before arrival

  const demandRatio = Math.min(donation.quantity, required) / required;
  const travelScore = 1 / (1 + travelSec / 3600); // 0–1 normalised
  const bufferScore = Math.min(expiryBuffer / 3600, 1); // cap at 1hr for scoring

  return W1 * demandRatio + W2 * travelScore + W3 * bufferScore;
}

/**
 * Match a single donation to shelters and create batches.
 * Returns array of created batch objects.
 */
function matchDonation(donation) {
  const { v4: uuidv4 } = require('uuid');
  const nowSec = Math.floor(Date.now() / 1000);

  if (donation.expiry_at <= nowSec) return []; // already expired

  const shelters = db.prepare(`
    SELECT s.*, u.name FROM shelters s JOIN users u ON s.id=u.id WHERE s.is_active=1
  `).all();

  const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };

  // Build scored list
  const scored = shelters
    .map(s => ({ shelter: s, score: scorePair(donation, s) }))
    .filter(x => x.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const batches = [];
  let remaining = donation.quantity;
  const usedShelters = new Set();

  for (const { shelter } of scored) {
    if (remaining <= 0) break;
    if (usedShelters.has(shelter.id)) continue;

    const alreadyCommitted = db.prepare(`
      SELECT COALESCE(SUM(b.quantity),0) as total
      FROM batches b JOIN donations d ON b.donation_id=d.id
      WHERE b.shelter_id=? AND d.aid_type=? AND b.status NOT IN ('EXPIRED','DELIVERED')
    `).get(shelter.id, donation.aid_type)?.total || 0;

    const shelterNeed = (shelter[fieldMap[donation.aid_type]] || 0) - alreadyCommitted;
    if (shelterNeed <= 0) continue;

    const batchQty = Math.min(remaining, shelterNeed);
    const batchId = uuidv4();

    db.prepare('INSERT INTO batches(id,donation_id,shelter_id,quantity) VALUES(?,?,?,?)')
      .run(batchId, donation.id, shelter.id, batchQty);

    batches.push({ id: batchId, donation_id: donation.id, shelter_id: shelter.id, quantity: batchQty });
    remaining -= batchQty;
    usedShelters.add(shelter.id);
  }

  // Update donation status
  if (batches.length > 0) {
    db.prepare("UPDATE donations SET status='MATCHED' WHERE id=?").run(donation.id);
  }

  return batches;
}

/**
 * Run matching for all PENDING donations.
 */
function runMatchAll() {
  const pending = db.prepare("SELECT * FROM donations WHERE status='PENDING'").all();
  const results = [];
  for (const d of pending) {
    const batches = matchDonation(d);
    if (batches.length) results.push({ donationId: d.id, batches });
  }
  return results;
}

module.exports = { haversine, matchDonation, runMatchAll };
