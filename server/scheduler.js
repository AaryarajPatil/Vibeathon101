'use strict';
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

module.exports = function startScheduler(io) {
  // --- Ghost Reservation Expiry (every 30s) ---
  cron.schedule('*/30 * * * * *', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = db.prepare(`
      SELECT r.*, b.donation_id FROM reservations r
      JOIN batches b ON r.batch_id = b.id
      WHERE r.status='PENDING' AND r.expires_at < ?
    `).all(now);

    for (const res of expired) {
      db.prepare("UPDATE reservations SET status='EXPIRED' WHERE id=?").run(res.id);
      db.prepare("UPDATE batches SET status='AVAILABLE' WHERE id=?").run(res.batch_id);
      db.prepare("UPDATE riders SET status='AVAILABLE' WHERE id=?").run(res.rider_id);

      const alertId = uuidv4();
      db.prepare("INSERT INTO alerts(id,type,payload) VALUES(?,?,?)").run(
        alertId, 'RESERVATION_EXPIRED',
        JSON.stringify({ reservationId: res.id, batchId: res.batch_id, riderId: res.rider_id })
      );

      if (io) {
        io.to(`rider:${res.rider_id}`).emit('reservation:expired', {
          batchId: res.batch_id,
          message: 'Your reservation has expired. The batch is now available to other riders.'
        });
        io.to('admin').emit('reservation:expired', {
          reservationId: res.id, batchId: res.batch_id, riderId: res.rider_id
        });
      }
    }
  });

  // --- Donation Expiry Warning (every 60s) ---
  cron.schedule('*/60 * * * * *', () => {
    const now = Math.floor(Date.now() / 1000);
    const warnMinutes = parseInt(process.env.EXPIRY_WARNING_MINUTES || '30', 10);
    const warnWindow = now + warnMinutes * 60;

    const expiringSoon = db.prepare(`
      SELECT * FROM donations
      WHERE status IN ('PENDING','MATCHED') AND expiry_at > ? AND expiry_at <= ?
    `).all(now, warnWindow);

    for (const don of expiringSoon) {
      const minutesLeft = Math.round((don.expiry_at - now) / 60);
      if (io) {
        io.to('admin').emit('donation:expiry_warning', {
          donationId: don.id, donorId: don.donor_id, minutesLeft, aidType: don.aid_type
        });
        io.to(`donor:${don.donor_id}`).emit('donation:expiry_warning', {
          donationId: don.id, minutesLeft, aidType: don.aid_type
        });
      }
    }

    // Mark truly expired donations
    db.prepare(`
      UPDATE donations SET status='EXPIRED' WHERE status IN ('PENDING','MATCHED') AND expiry_at <= ?
    `).run(now);
    db.prepare(`
      UPDATE batches SET status='EXPIRED'
      WHERE status IN ('AVAILABLE','RESERVED')
        AND donation_id IN (SELECT id FROM donations WHERE status='EXPIRED')
    `).run();
  });

  console.log('⏰ Scheduler started — ghost reservations checked every 30s, expiry warnings every 60s');
};
