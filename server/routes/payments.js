'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, authorize } = require('../auth');
const { calculateCompensation } = require('../logic/compensation');

const router = express.Router();

const PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD'];

// POST /api/payments/initiate
router.post('/initiate', authenticate, authorize('DONOR'), (req, res) => {
  const { delivery_id, amount, tip_amount, method } = req.body;
  if (!delivery_id || !method)
    return res.status(400).json({ error: 'delivery_id and method are required' });
  if (!PAYMENT_METHODS.includes(method))
    return res.status(400).json({ error: `method must be one of ${PAYMENT_METHODS.join(', ')}` });

  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(delivery_id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

  const existing = db.prepare("SELECT id FROM payments WHERE delivery_id=? AND status='SIMULATED_SUCCESS'").get(delivery_id);
  if (existing) return res.status(409).json({ error: 'Payment already completed for this delivery' });

  const payId = uuidv4();
  db.prepare(`
    INSERT INTO payments(id,delivery_id,donor_id,amount,tip_amount,method)
    VALUES(?,?,?,?,?,?)
  `).run(payId, delivery_id, req.user.id, amount || 0, tip_amount || 0, method);

  res.status(201).json({
    payment_id: payId,
    amount: amount || 0,
    tip_amount: tip_amount || 0,
    method,
    status: 'PENDING'
  });
});

// POST /api/payments/simulate — simulate success or failure
router.post('/simulate', authenticate, authorize('DONOR'), (req, res) => {
  const { payment_id, outcome } = req.body;
  if (!payment_id || !['success', 'fail'].includes(outcome))
    return res.status(400).json({ error: 'payment_id and outcome (success|fail) required' });

  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(payment_id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.donor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const now = Math.floor(Date.now() / 1000);
  const status = outcome === 'success' ? 'SIMULATED_SUCCESS' : 'FAILED';
  db.prepare('UPDATE payments SET status=?, paid_at=? WHERE id=?').run(status, now, payment_id);

  let compensation = null;
  if (status === 'SIMULATED_SUCCESS') {
    compensation = calculateCompensation(payment.delivery_id);
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`donor:${req.user.id}`).emit('payment:confirmed', { paymentId: payment_id, status, compensation });
    io.to('admin').emit('payment:confirmed', { paymentId: payment_id, status });
  }

  res.json({ payment_id, status, compensation });
});

// GET /api/payments/delivery/:deliveryId
router.get('/delivery/:deliveryId', authenticate, (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE delivery_id=?').get(req.params.deliveryId);
  if (!payment) return res.status(404).json({ error: 'No payment found for this delivery' });
  res.json(payment);
});

// GET /api/payments/compensation/:deliveryId
router.get('/compensation/:deliveryId', authenticate, (req, res) => {
  const comps = db.prepare(`
    SELECT rc.*, u.name as rider_name FROM rider_compensation rc
    JOIN users u ON rc.rider_id = u.id
    WHERE rc.delivery_id=?
  `).all(req.params.deliveryId);
  res.json(comps);
});

module.exports = router;
