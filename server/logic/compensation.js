'use strict';
const db = require('../db');

/**
 * Calculate and insert rider_compensation records for a completed delivery.
 */
function calculateCompensation(deliveryId) {
  const { v4: uuidv4 } = require('uuid');

  const payment = db.prepare(`
    SELECT * FROM payments WHERE delivery_id=? AND status='SIMULATED_SUCCESS'
  `).get(deliveryId);

  if (!payment) return null;

  const total = payment.amount + payment.tip_amount;
  const segments = db.prepare(`
    SELECT * FROM delivery_segments WHERE delivery_id=? ORDER BY segment_order
  `).all(deliveryId);

  // If no segments (single rider, no breakdown), create a default 100% segment
  const effectiveSegments = segments.length > 0
    ? segments
    : [{
        rider_id: db.prepare('SELECT rider_id FROM deliveries WHERE id=?').get(deliveryId)?.rider_id,
        pct_of_route: 1.0
      }];

  const compensations = [];
  for (const seg of effectiveSegments) {
    if (!seg.rider_id) continue;
    const basePayout = payment.amount * seg.pct_of_route;
    const tipShare   = payment.tip_amount * seg.pct_of_route;
    const rowTotal   = basePayout + tipShare;

    const id = uuidv4();
    db.prepare(`
      INSERT OR REPLACE INTO rider_compensation(id,delivery_id,rider_id,pct_share,base_amount,tip_share,total)
      VALUES(?,?,?,?,?,?,?)
    `).run(id, deliveryId, seg.rider_id, seg.pct_of_route, basePayout, tipShare, rowTotal);

    compensations.push({ rider_id: seg.rider_id, pct_share: seg.pct_of_route, total: rowTotal });
  }

  return compensations;
}

module.exports = { calculateCompensation };
