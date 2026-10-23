'use strict';
const { verifyToken } = require('./auth');
const db = require('./db');

module.exports = function registerSocketHandlers(io) {
  // Authenticate socket connection via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = verifyToken(token);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role, name } = socket.user;
    console.log(`🔌 [${role}] ${name} connected (${socket.id})`);

    // Join role-based rooms
    socket.join('admin'); // always join admin room for admin users
    if (role === 'ADMIN') {
      // Already in admin room
    } else if (role === 'RIDER') {
      socket.join(`rider:${id}`);
      socket.leave('admin');
    } else if (role === 'DONOR') {
      socket.join(`donor:${id}`);
      socket.leave('admin');
    } else if (role === 'SHELTER') {
      socket.join(`shelter:${id}`);
      socket.leave('admin');
    }

    // --- Rider: Real-time GPS update ---
    socket.on('rider:location_update', ({ lat, lng }) => {
      if (role !== 'RIDER') return;
      db.prepare('UPDATE riders SET lat=?, lng=?, updated_at=unixepoch() WHERE id=?').run(lat, lng, id);
      io.to('admin').emit('rider:location_updated', { riderId: id, lat, lng });
    });

    // --- Rider: Report breakdown via socket ---
    socket.on('rider:breakdown_report', ({ deliveryId, lat, lng }) => {
      if (role !== 'RIDER') return;
      const { handleBreakdown } = require('./logic/breakdown');
      const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(deliveryId);
      if (!delivery || delivery.rider_id !== id) return;

      const result = handleBreakdown(delivery, lat, lng);
      socket.emit('breakdown:ack', result);

      if (result.success) {
        io.to(`rider:${result.rescueRider.id}`).emit('breakdown:rescue_assigned', {
          deliveryId, breakdownLat: lat, breakdownLng: lng,
          pctOfRoute: result.pctB,
          message: `Pickup needed. You handle ${Math.round(result.pctB * 100)}% of route.`
        });
      }
      io.to('admin').emit('alert:critical', {
        type: 'BREAKDOWN', deliveryId, riderId: id,
        rescueRiderId: result.rescueRider?.id,
        pctA: result.pctA, pctB: result.pctB
      });
    });

    // --- Shelter: Toggle offline ---
    socket.on('shelter:close', () => {
      if (role !== 'SHELTER') return;
      db.prepare('UPDATE shelters SET is_active=0, updated_at=unixepoch() WHERE id=?').run(id);

      // Find any in-transit deliveries aimed at this shelter
      const affected = db.prepare(`
        SELECT * FROM deliveries WHERE dest_shelter_id=? AND status IN ('PENDING','PICKED_UP','IN_TRANSIT','REROUTED')
      `).all(id);

      for (const del of affected) {
        io.to('admin').emit('alert:critical', {
          type: 'SHELTER_CLOSED_DURING_DELIVERY',
          message: `Shelter ${id} closed while delivery ${del.id} is in transit`,
          deliveryId: del.id, shelterId: id
        });
      }

      io.to('admin').emit('shelter:status_changed', { shelterId: id, is_active: false });
    });

    // --- Admin: Force reroute ---
    socket.on('admin:force_reroute', ({ deliveryId, newShelterId }) => {
      if (role !== 'ADMIN') return;
      const { rerouteDelivery } = require('./logic/rerouting');
      const result = rerouteDelivery(deliveryId, newShelterId);
      socket.emit('reroute:result', result);

      const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(deliveryId);
      if (delivery) {
        io.to(`rider:${delivery.rider_id}`).emit('delivery:rerouted', {
          deliveryId, newShelterId, newShelter: result.newShelter
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 [${role}] ${name} disconnected`);
      if (role === 'RIDER') {
        db.prepare("UPDATE riders SET status='OFFLINE', updated_at=unixepoch() WHERE id=? AND status='AVAILABLE'").run(id);
      }
    });
  });
};
