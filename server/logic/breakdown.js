'use strict';
const db = require('../db');
const { haversine } = require('./matching');

/**
 * Find the nearest available rider to a given location
 * who has sufficient capacity for the given quantity.
 */
function findNearestRider(lat, lng, minCapacity = 0, excludeIds = []) {
  const riders = db.prepare(`
    SELECT r.*, u.name FROM riders r JOIN users u ON r.id=u.id
    WHERE r.status='AVAILABLE' AND r.capacity_kg >= ?
  `).all(minCapacity);

  if (riders.length === 0) return null;

  return riders
    .filter(r => !excludeIds.includes(r.id))
    .map(r => ({ ...r, dist: haversine(lat, lng, r.lat, r.lng) }))
    .sort((a, b) => a.dist - b.dist)[0] || null;
}

/**
 * Handle rider breakdown mid-delivery.
 * Creates delivery_segments, finds rescue rider, reassigns delivery.
 */
function handleBreakdown(delivery, breakdownLat, breakdownLng) {
  const { v4: uuidv4 } = require('uuid');
  const now = Math.floor(Date.now() / 1000);

  const shelter = db.prepare('SELECT * FROM shelters WHERE id=?').get(delivery.dest_shelter_id);
  if (!shelter) return { error: 'Shelter not found' };

  // Calculate % completed by Rider A
  const totalDist = haversine(delivery.origin_lat, delivery.origin_lng, shelter.lat, shelter.lng);
  const doneDist  = haversine(delivery.origin_lat, delivery.origin_lng, breakdownLat, breakdownLng);
  const pctA = totalDist > 0 ? Math.min(doneDist / totalDist, 0.99) : 0;
  const pctB = 1 - pctA;

  // Update delivery with breakdown info
  db.prepare(`
    UPDATE deliveries SET
      status='REROUTED', breakdown_lat=?, breakdown_lng=?,
      breakdown_at=?, route_pct_completed=?
    WHERE id=?
  `).run(breakdownLat, breakdownLng, now, pctA, delivery.id);

  // Mark Rider A as broken down
  db.prepare("UPDATE riders SET status='BREAKDOWN' WHERE id=?").run(delivery.rider_id);

  // Create segment for Rider A
  const segAId = uuidv4();
  db.prepare(`
    INSERT INTO delivery_segments(id,delivery_id,rider_id,segment_order,from_lat,from_lng,to_lat,to_lng,pct_of_route,status,started_at,completed_at)
    VALUES(?,?,?,1,?,?,?,?,?,'COMPLETED',?,?)
  `).run(segAId, delivery.id, delivery.rider_id,
    delivery.origin_lat, delivery.origin_lng, breakdownLat, breakdownLng,
    pctA, delivery.picked_up_at || now, now);

  // Find nearest available rider (exclude Rider A)
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(delivery.batch_id);
  const rescueRider = findNearestRider(breakdownLat, breakdownLng, batch?.quantity || 0, [delivery.rider_id]);

  if (!rescueRider) {
    return { success: false, pctA, pctB, message: 'No rescue rider available — admin notified' };
  }

  // Create segment for Rider B
  const segBId = uuidv4();
  db.prepare(`
    INSERT INTO delivery_segments(id,delivery_id,rider_id,segment_order,from_lat,from_lng,to_lat,to_lng,pct_of_route,status)
    VALUES(?,?,?,2,?,?,?,?,?,'PENDING')
  `).run(segBId, delivery.id, rescueRider.id,
    breakdownLat, breakdownLng, shelter.lat, shelter.lng, pctB);

  // Assign rescue rider to delivery
  db.prepare("UPDATE deliveries SET rider_id=?, status='IN_TRANSIT' WHERE id=?")
    .run(rescueRider.id, delivery.id);
  db.prepare("UPDATE riders SET status='BUSY' WHERE id=?").run(rescueRider.id);

  return { success: true, rescueRider, pctA, pctB, segAId, segBId };
}

module.exports = { findNearestRider, handleBreakdown };
