'use strict';
/**
 * db.js — SQLite database using Node 24 native node:sqlite DatabaseSync.
 * Zero external compilation, synchronous, lightweight, and fast.
 */
require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(process.env.DB_PATH || './data/aidsync.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const rawDb = new DatabaseSync(DB_PATH);
rawDb.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS shelters (
    id TEXT PRIMARY KEY,
    address TEXT,
    lat REAL DEFAULT 12.9716,
    lng REAL DEFAULT 77.5946,
    capacity INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    food_required REAL DEFAULT 0,
    medical_required REAL DEFAULT 0,
    kit_required REAL DEFAULT 0,
    compatibility_notes TEXT DEFAULT '',
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS riders (
    id TEXT PRIMARY KEY,
    lat REAL DEFAULT 12.9716,
    lng REAL DEFAULT 77.5946,
    capacity_kg REAL DEFAULT 20,
    status TEXT DEFAULT 'OFFLINE',
    vehicle_type TEXT DEFAULT 'BIKE',
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS donations (
    id TEXT PRIMARY KEY,
    donor_id TEXT NOT NULL,
    aid_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT DEFAULT 'kg',
    expiry_minutes INTEGER DEFAULT 120,
    expiry_at INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    pickup_address TEXT DEFAULT '',
    pickup_lat REAL DEFAULT 12.9716,
    pickup_lng REAL DEFAULT 77.5946,
    status TEXT DEFAULT 'PENDING',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    donation_id TEXT NOT NULL,
    shelter_id TEXT,
    quantity REAL NOT NULL,
    status TEXT DEFAULT 'AVAILABLE',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    rider_id TEXT NOT NULL,
    reserved_at INTEGER DEFAULT (strftime('%s','now')),
    expires_at INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    confirmed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    rider_id TEXT NOT NULL,
    origin_lat REAL,
    origin_lng REAL,
    dest_shelter_id TEXT,
    status TEXT DEFAULT 'PENDING',
    picked_up_at INTEGER,
    delivered_at INTEGER,
    breakdown_lat REAL,
    breakdown_lng REAL,
    breakdown_at INTEGER,
    route_pct_completed REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS delivery_segments (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    rider_id TEXT NOT NULL,
    segment_order INTEGER DEFAULT 1,
    from_lat REAL,
    from_lng REAL,
    to_lat REAL,
    to_lng REAL,
    pct_of_route REAL DEFAULT 1.0,
    status TEXT DEFAULT 'PENDING',
    started_at INTEGER,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    donor_id TEXT NOT NULL,
    amount REAL DEFAULT 0,
    tip_amount REAL DEFAULT 0,
    method TEXT,
    status TEXT DEFAULT 'PENDING',
    paid_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS rider_compensation (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    rider_id TEXT NOT NULL,
    pct_share REAL DEFAULT 1.0,
    base_amount REAL DEFAULT 0,
    tip_share REAL DEFAULT 0,
    total REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    resolved_at INTEGER
  );
`;

rawDb.exec(SCHEMA);

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

const db = {
  raw: rawDb,
  exec(sql) {
    return rawDb.exec(sql);
  },
  pragma(sql) {
    try {
      return rawDb.exec(`PRAGMA ${sql};`);
    } catch {
      return null;
    }
  },
  prepare(sql) {
    const stmt = rawDb.prepare(sql);
    return {
      run(...args) {
        const params = normalizeParams(args);
        return stmt.run(...params);
      },
      get(...args) {
        const params = normalizeParams(args);
        const res = stmt.get(...params);
        return res || undefined;
      },
      all(...args) {
        const params = normalizeParams(args);
        return stmt.all(...params);
      }
    };
  }
};

db.db = db;
db.initDb = async () => db;

module.exports = db;
