# AidSync — Real-Time Civic Aid Coordination & Last-Mile Logistics

> **The Last-Mile Spoilage Trap: Coordinating Perishable Surplus & Fragile Aid Under Uncertainty**  
> Built for the Vibeathon Hackathon.

AidSync is a real-time civic aid coordination and last-mile logistics platform connecting:
1. **Donors** — Donating perishable food, short-life medical supplies, and emergency kits with live requirement validation.
2. **Volunteer Riders** — Accepting split batches, handling GPS routing, reporting breakdowns, and executing mid-route handoffs.
3. **Receiving Shelters** — Managing dynamic capacity, food/medical/kit demands, and sudden status changes.
4. **Admin / Coordinator Dashboard** — Real-time event feed, smart matching algorithm, manual rerouting, and pro-rated rider compensation splits.

---

## 🚀 Key Features & Judge Simulation Scenarios

- **Tight Expiry Windows & Spoilage Prevention**: Real-time expiry timers, automated warning alerts at configurable thresholds, and automatic expiration when shelf-life ends.
- **Dynamic Batch Splitting**: Large surplus donations are automatically split into manageable batch sizes matched to rider vehicle capacities.
- **Ghost Reservation Expiry**: When a volunteer reserves a batch but does not confirm within the TTL (default 300s), the scheduler automatically releases the batch back to the pool.
- **Mid-Route Breakdown & Pro-Rata Compensation**: If a rider breaks down mid-delivery, the system detects the nearest available rescue rider using Haversine distance, divides the delivery into segments, and splits the base pay and tips proportionally (e.g. 40% / 60%).
- **Dynamic Rerouting**: If a shelter closes or reaches capacity mid-flight, coordinators and the system dynamically reroute active deliveries to the next highest-scoring shelter.
- **Interactive Multi-Method Payment & Tipping**: Donors can review completed deliveries, pay via simulated UPI, Card, Net Banking, Wallet, or COD, and add tips that are split across contributing riders.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js, native `node:sqlite` (DatabaseSync — zero external build tools, pure synchronous SQLite)
- **Real-Time**: Socket.IO for bidirectional live alerts, status updates, and coordination
- **Scheduling**: `node-cron` for ghost reservation timeouts and expiry warnings
- **Security & Auth**: JWT (`jsonwebtoken`) + `bcryptjs` role-based authentication
- **Frontend**: Vanilla HTML5, CSS3 (modern glassmorphism, responsive design tokens), Vanilla JavaScript API client

---

## 👥 Demo Accounts (Seeded)

| Role | Email | Password | Details |
|---|---|---|---|
| **Admin** | `admin@aidsync.in` | `admin123` | Central command & incident coordinator |
| **Donor** | `priya@donor.in` | `donor123` | Perishable food & medical donor |
| **Donor** | `rahul@donor.in` | `donor123` | Essential kits & meals donor |
| **Rider** | `arjun@rider.in` | `rider123` | Bike rider (25 kg capacity) |
| **Rider** | `sonia@rider.in` | `rider123` | Scooter rider (15 kg capacity) |
| **Rider** | `karan@rider.in` | `rider123` | Car rider (40 kg capacity) |
| **Shelter** | `care@shelter.in` | `shelter123` | City Care Shelter (MG Road) |
| **Shelter** | `hope@shelter.in` | `shelter123` | Hope Foundation (Koramangala) |
| **Shelter** | `asha@shelter.in` | `shelter123` | Asha Relief Camp (Rajajinagar) |

---

## 🏁 Quickstart

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Seed Initial Demo Data**:
   ```bash
   npm run seed
   ```

3. **Start the Platform**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

4. **Portals**:
   - Landing Page / Role Switcher: `http://localhost:3000/`
   - Donor Portal: `http://localhost:3000/donor`
   - Volunteer Rider Portal: `http://localhost:3000/rider`
   - Shelter Management: `http://localhost:3000/shelter`
   - Coordinator / Admin Dashboard: `http://localhost:3000/admin`
