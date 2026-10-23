'use strict';
const db = require('../db');
const { findNearestRider } = require('./breakdown');

/**
 * Find best alternative shelter for an in-transit delivery
 * when the current destination becomes unavailable.
 */
function findAlternativeShelter(delivery, excludeShelterId) {
  const donation = db.prepare(`
    SELECT d.* FROM donations d JOIN batches b ON b.donation_id=d.id WHERE b.id=?
  `).get(delivery.batch_id);
  if (!donation) return null;

  const fieldMap = { FOOD: 'food_required', MEDICAL: 'medical_required', KIT: 'kit_required' };
  const field = fieldMap[donation.aid_type];

  const shelters = db.prepare(`
    SELECT s.*, u.name FROM shelters s JOIN users u ON s.id=u.id
    WHERE s.is_active=1 AND s.id != ? AND s.${field} > 0
  `).all(excludeShelterId);

  if (!shelters.length) return null;

  // Pick nearest open shelter that still has need
  const { haversine } = require('./matching');
  const currentLat = delivery.breakdown_lat || delivery.origin_lat;
  const currentLng = delivery.breakdown_lng || delivery.origin_lng;

  return shelters
    .map(s => ({ ...s, dist: haversine(currentLat, currentLng, s.lat, s.lng) }))
    .sort((a, b) => a.dist - b.dist)[0] || null;
}

/**
 * Reroute a delivery to a new shelter.
 */
function rerouteDelivery(deliveryId, newShelterId) {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(deliveryId);
  if (!delivery) return { error: 'Delivery not found' };

  db.prepare(`
    UPDATE deliveries SET dest_shelter_id=?, status='REROUTED' WHERE id=?
  `).run(newShelterId, deliveryId);

  db.prepare('UPDATE batches SET shelter_id=? WHERE id=?')
    .run(newShelterId, delivery.batch_id);

  const newShelter = db.prepare('SELECT s.*, u.name FROM shelters s JOIN users u ON s.id=u.id WHERE s.id=?').get(newShelterId);
  return { success: true, delivery: { ...delivery, dest_shelter_id: newShelterId }, newShelter };
}

module.exports = { findAlternativeShelter, rerouteDelivery };
