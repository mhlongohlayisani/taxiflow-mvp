const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

// In-memory store for active emergency panic alerts
let activePanicAlerts = {};

function getTodayDate() {
    return new Date().toISOString().split("T")[0];
}

router.use((req, res, next) => {
    console.log(`🔍 [DRIVER ROUTE HIT]: ${req.method} ${req.originalUrl}`);
    next();
});

// ==========================================
// 1. DRIVER DASHBOARD & PROFILE
// ==========================================
router.get("/dashboard/:driverId", async (req, res) => {
    try {
        const { driverId } = req.params;
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, full_name, username, phone, email, role, account_status, managed_route")
            .eq("id", driverId)
            .in("role", ["TAXI_DRIVER", "BUS_DRIVER", "DRIVER"])
            .maybeSingle();

        if (userError || !user) {
            return res.status(404).json({ success: false, message: "Driver account not found." });
        }

        const { data: vehicle } = await supabase
            .from("vehicles")
            .select("*")
            .eq("driver_id", driverId)
            .maybeSingle();

        const { data: membership } = await supabase
            .from("rank_memberships")
            .select("rank_id, status")
            .eq("driver_id", driverId)
            .eq("status", "APPROVED")
            .limit(1)
            .maybeSingle();

        let rank = null;
        let queueItem = null;

        if (membership && membership.rank_id) {
            const { data: rankData } = await supabase
                .from("ranks")
                .select("id, name, address, is_open, latitude, longitude")
                .eq("id", membership.rank_id)
                .maybeSingle();
            rank = rankData;

            const today = getTodayDate();
            const { data: qData } = await supabase
                .from("rank_queue")
                .select("id, queue_position, status, queue_date")
                .eq("rank_id", membership.rank_id)
                .eq("driver_id", driverId)
                .eq("queue_date", today)
                .maybeSingle();
            queueItem = qData;
        }

        return res.json({
            success: true,
            driver: user,
            vehicle: vehicle || null,
            rank: rank || null,
            queue: queueItem || null
        });
    } catch (err) {
        console.error("Driver dashboard error:", err);
        return res.status(500).json({ success: false, message: "Server error loading driver dashboard." });
    }
});

// ==========================================
// 2. UPDATE PASSENGER & SEAT CAPACITY
// ==========================================
router.post("/capacity", async (req, res) => {
    try {
        const { driver_id, passengers_inside, availability_status } = req.body;
        const { data: vehicle } = await supabase.from("vehicles").select("passenger_capacity").eq("driver_id", driver_id).single();

        const maxCap = vehicle ? vehicle.passenger_capacity : 15;
        const currentPassengers = Number(passengers_inside) || 0;
        const seatsLeft = Math.max(0, maxCap - currentPassengers);
        const status = availability_status || (seatsLeft === 0 ? "FULL" : "NOT_FULL");

        const { data, error } = await supabase
            .from("vehicles")
            .update({ passengers_inside: currentPassengers, seats_available: seatsLeft, availability_status: status })
            .eq("driver_id", driver_id)
            .select()
            .single();

        if (error) throw error;
        return res.json({ success: true, message: "Capacity updated.", vehicle: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 3. BROADCAST LIVE GPS LOCATION
// ==========================================
router.post("/location", async (req, res) => {
    try {
        const { driver_id, latitude, longitude, show_on_map, destination } = req.body;

        const updatePayload = {
            latitude: latitude !== null && latitude !== undefined ? Number(latitude) : null,
            longitude: longitude !== null && longitude !== undefined ? Number(longitude) : null,
            // Force true if they are broadcasting destination or location, unless explicitly set to false
            show_on_map: show_on_map !== undefined ? Boolean(show_on_map) : true,
            last_location_update: new Date().toISOString()
        };

        if (destination !== undefined) {
            updatePayload.destination = destination;
        }

        const { data, error } = await supabase
            .from("vehicles")
            .update(updatePayload)
            .eq("driver_id", driver_id)
            .select()
            .single();

        if (error) throw error;
        return res.json({ success: true, vehicle: data });
    } catch (err) {
        console.error("Location error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST Route: Set Driver's Daily Passcode
router.post('/:id/passcode', async (req, res) => {
    const driverId = req.params.id;
    const { passcode } = req.body;

    if (!passcode) {
        return res.status(400).json({ success: false, message: 'Passcode is required.' });
    }

    try {
        // 1. Fetch current driver passcode data
        const { data: driver, error: fetchErr } = await supabase
            .from('users')
            .select('daily_passcode, passcode_updated_at')
            .eq('id', driverId)
            .single();

        if (fetchErr) throw fetchErr;

        // 2. Check if a passcode already exists for today
        if (driver && driver.daily_passcode && driver.passcode_updated_at) {
            const lastUpdated = new Date(driver.passcode_updated_at);
            const now = new Date();
            
            // Check if it's the exact same calendar day
            const isToday = lastUpdated.toDateString() === now.toDateString();
            
            if (isToday) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'You have already generated a passcode for today. It expires at 23:59.' 
                });
            }
        }

        // 3. Save new passcode with current timestamp
        const { error: updateErr } = await supabase
            .from('users')
            .update({
                daily_passcode: passcode,
                passcode_updated_at: new Date().toISOString()
            })
            .eq('id', driverId);

        if (updateErr) throw updateErr;

        res.json({ success: true, message: 'Passcode updated successfully.', passcode: passcode });
    } catch (err) {
        console.error('Error setting passcode:', err);
        res.status(500).json({ success: false, message: 'Server error updating passcode.' });
    }
});


// DRIVER GPS POSITION UPDATE ENDPOINT
// DRIVER GPS UPDATE: Checks if active, then updates coordinates
router.post('/update-gps', async (req, res) => {
    const { driver_id, latitude, longitude } = req.body;

    if (!driver_id || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    try {
        // 1. Check if an active dispatched trip exists for this driver
        const { data: trip, error: fetchErr } = await supabase
            .from('active_dispatched_trips')
            .select('id, vehicle_reg, status')
            .eq('driver_id', String(driver_id))
            .eq('status', 'DISPATCHED')
            .single();

        if (fetchErr || !trip) {
            // Driver is not currently on an active dispatched trip, so ignore or return quiet success
            return res.json({ success: true, active: false, message: 'No active trip found for driver.' });
        }

        // 2. If they exist in the active table, update their coordinates and timestamp
        const { error: updateErr } = await supabase
            .from('active_dispatched_trips')
            .update({
                last_latitude: latitude,
                last_longitude: longitude,
                last_updated: new Date()
            })
            .eq('id', trip.id);

        if (updateErr) throw updateErr;

        res.json({ success: true, active: true, message: 'GPS updated successfully.' });
    } catch (err) {
        console.error('Error updating driver GPS:', err);
        res.status(500).json({ success: false, message: 'Server error updating GPS.' });
    }
});
// ==========================================
// 4. GET ALL ACTIVE LIVE DRIVERS
// ==========================================
router.get("/live", async (req, res) => {
    try {
        const { data: vehicles, error } = await supabase
            .from("vehicles")
            .select(`id, driver_id, latitude, longitude, show_on_map, passengers_inside, seats_available, availability_status, destination, last_location_update`)
            .eq("show_on_map", true);

        if (error) throw error;

        const liveDrivers = (vehicles || []).map(v => ({
            id: v.id,
            driver_id: v.driver_id,
            latitude: v.latitude,
            longitude: v.longitude,
            show_on_map: v.show_on_map,
            passengers_inside: v.passengers_inside || 0,
            is_full: v.availability_status === "FULL" || v.seats_available === 0,
            destination: v.destination || "Not Specified" // Pulls real destination now!
        }));

        return res.json({ success: true, drivers: liveDrivers });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 5. DRIVER APPLIES FOR A SECOND RANK (Strict Check)
// ==========================================
router.post(["/rank-application", "/rank-applications"], async (req, res) => {
    try {
        const { driver_id, rank_id } = req.body;
        if (!driver_id || !rank_id) return res.status(400).json({ success: false, message: "Driver ID and Rank ID are required." });

        const { data: driverUser, error: driverErr } = await supabase.from("users").select("role").eq("id", driver_id).single();
        if (driverErr || !driverUser) return res.status(404).json({ success: false, message: "Driver not found." });

        const driverRole = String(driverUser.role || "").toUpperCase();
        const { data: targetRank, error: rankErr } = await supabase.from("ranks").select("*").eq("id", rank_id).single();
        
        if (rankErr || !targetRank) return res.status(404).json({ success: false, message: "Target rank not found." });

        const rankName = String(targetRank.name || "").toLowerCase();
        if (driverRole === "TAXI_DRIVER" && rankName.includes("bus")) {
            return res.status(403).json({ success: false, message: "Access Denied: Taxi drivers can only apply to Taxi ranks." });
        }
        if (driverRole === "BUS_DRIVER" && (rankName.includes("taxi") || rankName.includes("cab"))) {
            return res.status(403).json({ success: false, message: "Access Denied: Bus drivers can only apply to Bus ranks." });
        }

        const { data: memberships, error: countError } = await supabase.from("rank_memberships").select("id, rank_id, status").eq("driver_id", driver_id);
        if (countError) throw countError;

        if (memberships && memberships.length >= 2) return res.status(400).json({ success: false, message: "Drivers can belong to a maximum of two ranks." });
        if ((memberships || []).some(m => m.rank_id === rank_id)) return res.status(400).json({ success: false, message: "You have already applied or registered with this rank." });

        const { data, error } = await supabase.from("rank_memberships").insert({ driver_id, rank_id, status: "PENDING" }).select().single();
        if (error) throw error;

        return res.json({ success: true, message: "Application submitted successfully.", membership: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 6. QR CODE AND VERIFICATION
// ==========================================
router.get("/verify", async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).json({ success: false, message: "Code parameter missing." });

        const cleanCode = code.trim().toUpperCase();
        let { data: vehicle } = await supabase.from("vehicles").select("driver_id, registration_number, users(id, full_name, username, phone)").ilike("registration_number", cleanCode).maybeSingle();

        let driverId = vehicle?.driver_id;
        if (!driverId) {
            const { data: userById } = await supabase.from("users").select("id, full_name, username, phone").eq("id", code.trim()).maybeSingle();
            if (userById) {
                driverId = userById.id;
                const { data: vehByUser } = await supabase.from("vehicles").select("registration_number").eq("driver_id", driverId).maybeSingle();
                vehicle = { registration_number: vehByUser?.registration_number || "N/A", users: userById };
            }
        }

        if (!driverId || !vehicle) return res.status(404).json({ success: false, message: "Vehicle or driver not found." });

        res.json({ success: true, driver: { id: vehicle.users.id, name: vehicle.users.full_name || vehicle.users.username || "Driver", phone: vehicle.users.phone || "N/A", vehicle_registration: vehicle.registration_number } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/qr-code/:driverId", async (req, res) => {
    try {
        const { driverId } = req.params;
        const { data: user } = await supabase.from("users").select("full_name, username, phone, email").eq("id", driverId).single();
        const { data: vehicle } = await supabase.from("vehicles").select("registration_number").eq("driver_id", driverId).maybeSingle();
        
        if (!user) return res.status(404).json({ success: false, message: "Driver not found." });

        const qrPayload = JSON.stringify({ driver_id: driverId, name: user.full_name || user.username || "Driver", vehicle: vehicle?.registration_number || "N/A", phone: user.phone || "N/A" });
        res.json({ success: true, qrPayload, driver: user, vehicle });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/qr-code/verify", async (req, res) => {
    try {
        const { driver_id } = req.body;
        const { data: user } = await supabase.from("users").select("id, full_name, username, phone").eq("id", driver_id).single();
        const { data: vehicle } = await supabase.from("vehicles").select("registration_number").eq("driver_id", driver_id).maybeSingle();
        
        if (!user) return res.status(404).json({ success: false, message: "Invalid driver." });
        res.json({ success: true, driver: { id: user.id, name: user.full_name || user.username, phone: user.phone, vehicle_registration: vehicle?.registration_number || "N/A" } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 7. PANIC & SAFETY REPORTS
// ==========================================
router.post("/report", upload.single("evidence"), async (req, res) => {
    try {
        let { driver_id, rank_id, violation_type, description, transport_type, commuter_name } = req.body;
        const evidenceFile = req.file ? `/uploads/${req.file.filename}` : null;
        
        if (!driver_id || !violation_type) return res.status(400).json({ success: false, message: "Missing required details." });

        const { data: membership } = await supabase.from("rank_memberships").select("rank_id").eq("driver_id", driver_id).eq("status", "APPROVED").maybeSingle();
        if (!membership) return res.status(400).json({ success: false, message: "Cannot file report: Driver is not approved under any official rank." });

        const { data, error } = await supabase.from("driver_safety_reports").insert({
            driver_id, rank_id: membership.rank_id, violation_type, description, transport_type: transport_type || 'TAXI', commuter_name: commuter_name || 'Anonymous', evidence_url: evidenceFile, status: 'PENDING'
        }).select().single();

        if (error) throw error;
        return res.json({ success: true, report: data, message: "Safety report filed." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/panic", async (req, res) => {
    try {
        const { driver_id, name, latitude, longitude } = req.body;
        if (!driver_id) return res.status(400).json({ success: false, message: "Driver ID required." });

        activePanicAlerts[driver_id] = { driver_id, name: name || "Driver", latitude: Number(latitude), longitude: Number(longitude), timestamp: Date.now() };

        const { data: memberships } = await supabase.from("rank_memberships").select("rank_id").eq("driver_id", driver_id).eq("status", "APPROVED");
        await supabase.from("driver_safety_reports").insert({
            driver_id, rank_id: memberships && memberships.length > 0 ? memberships[0].rank_id : null, violation_type: "EMERGENCY_PANIC_ALERT", description: `🚨 SOS EMERGENCY at [${latitude}, ${longitude}]`, transport_type: "TAXI", commuter_name: "DRIVER SOS SYSTEM", status: "URGENT"
        });

        return res.json({ success: true, message: "Panic alert broadcasted." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/panic/cancel", async (req, res) => {
    try {
        const { driver_id } = req.body;
        if (driver_id && activePanicAlerts[driver_id]) delete activePanicAlerts[driver_id];
        return res.json({ success: true, message: "Panic alert cleared." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/panic/active", async (req, res) => {
    try {
        const now = Date.now();
        Object.keys(activePanicAlerts).forEach(id => {
            if (now - activePanicAlerts[id].timestamp > 30 * 60 * 1000) delete activePanicAlerts[id];
        });
        return res.json({ success: true, alerts: Object.values(activePanicAlerts) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/deviation-report", async (req, res) => {
    try {
        const { driver_id, rank_id, description, latitude, longitude } = req.body;
        const { data, error } = await supabase.from("driver_safety_reports").insert({ driver_id, rank_id, violation_type: "ROUTE_DEVIATION_OR_STOPPAGE", description: description || "Vehicle idle/off-route.", status: "PENDING" }).select().single();
        if (error) throw error;
        res.json({ success: true, message: "Deviation logged.", report: data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/help/active", async (req, res) => {
    try {
        const { data: alerts, error } = await supabase.from("driver_safety_reports").select("driver_id, description, created_at, ranks(name)").eq("status", "PUBLISHED");
        if (error) throw error;

        const driverIds = [...new Set((alerts || []).map(a => a.driver_id))];
        let driverMap = {};

        if (driverIds.length > 0) {
            const { data: driverLocations } = await supabase.from("driver_locations").select("driver_id, latitude, longitude, users(full_name, username)").in("driver_id", driverIds);
            (driverLocations || []).forEach(loc => { driverMap[loc.driver_id] = { latitude: loc.latitude, longitude: loc.longitude, name: loc.users?.full_name || loc.users?.username || "Driver" }; });
        }

        const formattedAlerts = (alerts || []).map(a => ({ driver_id: a.driver_id, driver_name: driverMap[a.driver_id]?.name || "Driver", latitude: driverMap[a.driver_id]?.latitude || -23.8333, longitude: driverMap[a.driver_id]?.longitude || 30.1667, description: a.description }));
        res.json({ success: true, alerts: formattedAlerts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 8. MISC
// ==========================================
router.get("/memberships", async (req, res) => {
    try {
        const { driverId } = req.query;
        const { data: memberships, error } = await supabase.from("rank_memberships").select("rank_id, status, ranks(*)").eq("driver_id", driverId).eq("status", "APPROVED");
        if (error) throw error;
        
        const approvedRanks = (memberships || []).map(m => m.ranks).filter(Boolean);
        res.json({ success: true, memberships, approvedRanks });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;