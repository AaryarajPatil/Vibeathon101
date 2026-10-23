'use strict';
/**
 * AidSync — Demo Seed Script
 * Run: node server/seed.js
 * Clears and seeds admin, shelters, riders, donors and sample donations for demo.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('🌱 Seeding AidSync demo data...\n');

function hash(pw) { return bcrypt.hashSync(pw, 10); }
function now() { return Math.floor(Date.now() / 1000); }

// Clean existing data for a fresh demo run
db.exec(`
  DELETE FROM alerts;
  DELETE FROM rider_compensation;
  DELETE FROM payments;
  DELETE FROM delivery_segments;
  DELETE FROM deliveries;
  DELETE FROM reservations;
  DELETE FROM batches;
  DELETE FROM donations;
  DELETE FROM riders;
  DELETE FROM shelters;
  DELETE FROM users;
`);

// ── USERS ──────────────────────────────────────────────────────────────────
const users = [
  { id: 'usr-admin-01',   name: 'Admin Coordinator', email: 'admin@aidsync.in',   password: hash('admin123'),   role: 'ADMIN',   phone: '+91-9000000001' },
  { id: 'usr-donor-01',   name: 'Priya Sharma',      email: 'priya@donor.in',     password: hash('donor123'),   role: 'DONOR',   phone: '+91-9000000002' },
  { id: 'usr-donor-02',   name: 'Rahul Mehta',       email: 'rahul@donor.in',     password: hash('donor123'),   role: 'DONOR',   phone: '+91-9000000003' },
  { id: 'usr-rider-01',   name: 'Arjun Rider',       email: 'arjun@rider.in',     password: hash('rider123'),   role: 'RIDER',   phone: '+91-9000000004' },
  { id: 'usr-rider-02',   name: 'Sonia Rider',       email: 'sonia@rider.in',     password: hash('rider123'),   role: 'RIDER',   phone: '+91-9000000005' },
  { id: 'usr-rider-03',   name: 'Karan Rider',       email: 'karan@rider.in',     password: hash('rider123'),   role: 'RIDER',   phone: '+91-9000000006' },
  { id: 'usr-shelter-01', name: 'City Care Shelter', email: 'care@shelter.in',    password: hash('shelter123'), role: 'SHELTER', phone: '+91-9000000007' },
  { id: 'usr-shelter-02', name: 'Hope Foundation',   email: 'hope@shelter.in',    password: hash('shelter123'), role: 'SHELTER', phone: '+91-9000000008' },
  { id: 'usr-shelter-03', name: 'Asha Relief Camp',  email: 'asha@shelter.in',    password: hash('shelter123'), role: 'SHELTER', phone: '+91-9000000009' },
];

const insertUser = db.prepare('INSERT INTO users(id,name,email,password,role,phone) VALUES(?,?,?,?,?,?)');
for (const u of users) {
  insertUser.run(u.id, u.name, u.email, u.password, u.role, u.phone);
  console.log(`  👤 ${u.role.padEnd(7)} ${u.name} (${u.email} / password: ${u.role.toLowerCase()}123)`);
}

// ── SHELTER PROFILES ───────────────────────────────────────────────────────
const shelters = users.filter(u => u.role === 'SHELTER');
const shelterProfiles = [
  { food: 45, medical: 15, kit: 8,  cap: 120, lat: 12.9716, lng: 77.5946, addr: 'MG Road, Bengaluru', compat: 'Vegetarian only. No nuts.' },
  { food: 30, medical: 10, kit: 5,  cap: 80,  lat: 12.9352, lng: 77.6245, addr: 'Koramangala, Bengaluru', compat: 'Diabetic-friendly medical supplies preferred.' },
  { food: 60, medical: 20, kit: 12, cap: 200, lat: 12.9539, lng: 77.4960, addr: 'Rajajinagar, Bengaluru', compat: '' },
];

const insertShelter = db.prepare('INSERT INTO shelters(id,address,lat,lng,capacity,food_required,medical_required,kit_required,compatibility_notes) VALUES(?,?,?,?,?,?,?,?,?)');
shelters.forEach((s, i) => {
  const p = shelterProfiles[i];
  insertShelter.run(s.id, p.addr, p.lat, p.lng, p.cap, p.food, p.medical, p.kit, p.compat);
  console.log(`  🏠 Shelter: ${s.name} @ ${p.addr}`);
});

// ── RIDER PROFILES ─────────────────────────────────────────────────────────
const riders = users.filter(u => u.role === 'RIDER');
const riderProfiles = [
  { lat: 12.9650, lng: 77.5980, cap: 25, vehicle: 'BIKE',    status: 'AVAILABLE' },
  { lat: 12.9400, lng: 77.6100, cap: 15, vehicle: 'SCOOTER', status: 'AVAILABLE' },
  { lat: 12.9580, lng: 77.4900, cap: 40, vehicle: 'CAR',     status: 'AVAILABLE' },
];

const insertRider = db.prepare('INSERT INTO riders(id,lat,lng,capacity_kg,vehicle_type,status) VALUES(?,?,?,?,?,?)');
riders.forEach((r, i) => {
  const p = riderProfiles[i];
  insertRider.run(r.id, p.lat, p.lng, p.cap, p.vehicle, p.status);
  console.log(`  🏍️ Rider: ${r.name} — ${p.vehicle} (${p.cap}kg) — ${p.status}`);
});

// ── SAMPLE DONATIONS ───────────────────────────────────────────────────────
const donors = users.filter(u => u.role === 'DONOR');
const donations = [
  { id: 'don-food-01', donor: donors[0], type: 'FOOD',    qty: 20, mins: 90,  addr: 'Indiranagar, Bengaluru', lat: 12.9784, lng: 77.6408, notes: 'Biryani and dal - vegetarian' },
  { id: 'don-med-01',  donor: donors[0], type: 'MEDICAL', qty: 8,  mins: 240, addr: 'HSR Layout, Bengaluru',  lat: 12.9116, lng: 77.6473, notes: 'Bandages, antiseptic, paracetamol' },
  { id: 'don-kit-01',  donor: donors[1], type: 'KIT',     qty: 5,  mins: 480, addr: 'Whitefield, Bengaluru',  lat: 12.9698, lng: 77.7500, notes: 'Blankets, torch, water purification tabs' },
  { id: 'don-food-02', donor: donors[1], type: 'FOOD',    qty: 15, mins: 60,  addr: 'Jayanagar, Bengaluru',   lat: 12.9250, lng: 77.5938, notes: 'Rice and sambar - vegetarian' },
];

const insertDon = db.prepare('INSERT INTO donations(id,donor_id,aid_type,quantity,unit,expiry_minutes,expiry_at,notes,pickup_address,pickup_lat,pickup_lng) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
for (const d of donations) {
  const expiryAt = now() + d.mins * 60;
  insertDon.run(d.id, d.donor.id, d.type, d.qty, d.type === 'FOOD' ? 'kg' : 'units', d.mins, expiryAt, d.notes, d.addr, d.lat, d.lng);
  console.log(`  📦 Donation: ${d.type} × ${d.qty} from ${d.donor.name} (expires in ${d.mins}min)`);
}

// ── PRINT LOGIN CREDENTIALS ────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ SEED COMPLETE — Demo Login Credentials
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🎛️  ADMIN
      Email: admin@aidsync.in    | Password: admin123

  🤲 DONORS
      Email: priya@donor.in      | Password: donor123
      Email: rahul@donor.in      | Password: donor123

  🏍️  RIDERS
      Email: arjun@rider.in      | Password: rider123
      Email: sonia@rider.in      | Password: rider123
      Email: karan@rider.in      | Password: rider123

  🏠 SHELTERS
      Email: care@shelter.in     | Password: shelter123
      Email: hope@shelter.in     | Password: shelter123
      Email: asha@shelter.in     | Password: shelter123

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💡 DEMO FLOW:
     1. Login as ADMIN → Run Match → see batches created
     2. Login as RIDER → Go Online → Reserve a batch → Confirm
     3. Mark Picked Up → Mark Delivered (or Report Breakdown)
     4. Login as DONOR → My Donations → Pay & Tip Rider
     5. Admin dashboard shows live compensation split
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
