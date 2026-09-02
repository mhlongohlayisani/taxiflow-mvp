const express = require("express");
const router = express.Router();
// ---> ADD THIS DEBUG LOGGER HERE <---
router.use((req, res, next) => {
    console.log(`[RANK-ADMIN ROUTE HIT]: ${req.method} ${req.originalUrl}`);
    next();
});

const supabase = require("../config/supabase");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { verifyToken } = require("../middleware/authenticateToken");

router.use(verifyToken, (req, res, next) => {
    const role = String(req.user?.role || "").toUpperCase();
    const isRankAdmin = ["TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"].includes(role);
    const isDriver = ["TAXI_DRIVER", "BUS_DRIVER", "DRIVER"].includes(role);
    const driverReadOnlyQueue = isDriver && req.method === "GET" && req.path.startsWith("/queue/");
    const driverTripStart = isDriver && req.method === "POST" && req.path === "/trips/start";

    if (!isRankAdmin && !driverReadOnlyQueue && !driverTripStart) {
        return res.status(403).json({ success: false, message: "You do not have permission to use this rank-admin feature." });
    }

    if (isRankAdmin) {
        req.query.adminId = req.user.id;
        req.headers["x-admin-id"] = req.user.id;
        if (req.body && typeof req.body === "object") {
            req.body.admin_id = req.user.id;
            req.body.sender_admin_id = req.user.id;
        }
    }
    next();
});

function getTodayDate() {
    return new Date().toISOString().split("T")[0];
}

function clean(value) {
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? value.trim() : value;
}

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `rank-${req.body.rank_id || "photo"}-${Date.now()}-${Math.round(Math.random()*1000)}${ext}`);
    }
});
const uploadPhotos = multer({ storage: photoStorage });

// UPDATED TO ACCEPT TAXI_RANK_ADMIN (and legacy RANK_ADMIN)
async function getRankAdmin(userId) {
    if (!userId) return null;
    const { data } = await supabase.from("users").select("*").eq("id", userId).in("role", ["BUS_RANK_ADMIN", "TAXI_RANK_ADMIN", "RANK_ADMIN"]).maybeSingle();
    return data;
}

async function verifyActiveRankAdmin(userId) {
    const admin = await getRankAdmin(userId);
    if (!admin) return { allowed: false, error: "Invalid Rank Admin account." };
    if (admin.account_status !== "ACTIVE") return { allowed: false, error: "Account is pending Super Admin approval." };
    return { allowed: true, admin };
}

// Get the exact Rank tied uniquely to this admin instance
async function getAdminRank(adminId) {
    if (!adminId) return null;

    const { data: adminUser } = await supabase.from("users").select("existing_rank_id, managed_route").eq("id", adminId).maybeSingle();
    if (!adminUser) return null;

    if (adminUser.existing_rank_id) {
        const { data: rankData } = await supabase.from("ranks").select("*").eq("id", adminUser.existing_rank_id).maybeSingle();
        if (rankData) {
            return {
                ...rankData,
                managed_route: adminUser.managed_route
            };
        }
    }

    const { data: app } = await supabase.from("rank_applications").select("rank_id").eq("applicant_id", adminId).maybeSingle();
    if (app && app.rank_id) {
        const { data } = await supabase.from("ranks").select("*").eq("id", app.rank_id).maybeSingle();
        if (data) return { ...data, managed_route: adminUser.managed_route };
    }

    const { data } = await supabase.from("ranks").select("*").eq("admin_id", adminId).maybeSingle();
    return data ? { ...data, managed_route: adminUser.managed_route } : null;
}

async function getDriverProfiles(driverIds) {
    if (!driverIds || driverIds.length === 0) return [];
    const { data: users } = await supabase.from("users").select("id, full_name, username, phone, email, account_status, managed_route").in("id", driverIds);
    const { data: vehicles } = await supabase.from("vehicles").select("id, driver_id, registration_number, passenger_capacity").in("driver_id", driverIds);

    const userMap = {}; (users || []).forEach(u => userMap[u.id] = u);
    const vehicleMap = {}; (vehicles || []).forEach(v => vehicleMap[v.driver_id] = v);

    return driverIds.map(dId => {
        const u = userMap[dId] || {};
        const v = vehicleMap[dId] || {};
        return {
            id: dId, 
            driver_id: dId, 
            name: u.full_name || u.username || "Unknown Driver", 
            username: u.username || "N/A",
            phone: u.phone || "N/A", 
            email: u.email || "N/A", 
            account_status: u.account_status || "PENDING",
            managed_route: u.managed_route || "",
            vehicle_id: v.id || null, 
            vehicle_registration: v.registration_number || "No Vehicle", 
            passenger_capacity: v.passenger_capacity || 15
        };
    });
}
// ==========================================
// DASHBOARD
// ==========================================
router.get("/dashboard/:userId", async (req, res) => {
    try {
        const userId = req.user.id;
        const admin = await getRankAdmin(userId);
        if (!admin) return res.status(403).json({ success: false, message: "Access denied." });

        const rank = await getAdminRank(userId);
        if (!rank) {
            return res.json({ success: true, rankAdmin: admin, rank: null, stats: { drivers: { total: 0, pending: 0, active: 0 }, taxis: { total: 0 } }, taxis: [] });
        }

        const { data: memberships } = await supabase.from("rank_memberships").select("driver_id, status").eq("rank_id", rank.id);

        const driverIds = (memberships || []).map(m => m.driver_id);
        const profiles = await getDriverProfiles(driverIds);

        const routeFilteredProfiles = profiles.filter(p => {
            if (!rank.managed_route || rank.managed_route.toLowerCase() === "all routes") return true;
            return p.managed_route && p.managed_route.toLowerCase().trim() === rank.managed_route.toLowerCase().trim();
        });

        const filteredDriverIds = new Set(routeFilteredProfiles.map(p => p.driver_id));
        const filteredMemberships = (memberships || []).filter(m => filteredDriverIds.has(m.driver_id));

        const totalDrivers = filteredMemberships.filter(m => m.status === "APPROVED").length;
        const pendingDrivers = filteredMemberships.filter(m => m.status === "PENDING").length;

        const { data: queue } = await supabase.from("rank_queue").select("driver_id").eq("rank_id", rank.id).eq("queue_date", getTodayDate()).eq("status", "WAITING");
        const activeDrivers = queue ? new Set(queue.filter(q => filteredDriverIds.has(q.driver_id)).map(q => q.driver_id)).size : 0;

        res.json({
            success: true,
            rankAdmin: admin,
            rank: {
                ...rank,
                managed_route: admin.managed_route || rank.managed_route
            },
            stats: { drivers: { total: totalDrivers || 0, pending: pendingDrivers || 0, active: activeDrivers }, taxis: { total: totalDrivers || 0 } }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// DRIVER REQUESTS
// ==========================================
router.get("/driver-requests/:rankId", async (req, res) => {
    try {
        const { rankId } = req.params;
        const adminId = req.query.adminId || req.headers['x-admin-id'];
        const rank = await getAdminRank(adminId);

        // Fetch all pending memberships explicitly for this specific rank ID
        const { data: memberships, error } = await supabase
            .from("rank_memberships")
            .select("*")
            .eq("rank_id", rankId)
            .eq("status", "PENDING");

        if (error) throw error;
        if (!memberships || memberships.length === 0) {
            return res.json({ success: true, requests: [] });
        }

        // Get driver profile details for these pending requests
        const profiles = await getDriverProfiles(memberships.map(m => m.driver_id));

        const requests = memberships.map(m => ({
            request_id: m.id,
            ...(profiles.find(p => p.driver_id === m.driver_id) || {})
        }));

        res.json({ success: true, requests });
    } catch (err) {
        console.error("Fetch driver requests error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/driver-request/respond", async (req, res) => {
    try {
        const { request_id, status, admin_id } = req.body;
        const gate = await verifyActiveRankAdmin(admin_id);
        if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });
        const { error } = await supabase.from("rank_memberships").update({ status: status.toUpperCase() }).eq("id", request_id);
        if (error) throw error;
        res.json({ success: true, message: `Driver request ${status.toLowerCase()} successfully.` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get("/drivers/:rankId", async (req, res) => {
    try {
        const adminId = req.query.adminId;
        const rank = await getAdminRank(adminId);

        const { data: memberships } = await supabase.from("rank_memberships").select("driver_id").eq("rank_id", req.params.rankId).eq("status", "APPROVED");
        if (!memberships || memberships.length === 0) return res.json({ success: true, drivers: [] });

        const profiles = await getDriverProfiles(memberships.map(m => m.driver_id));
        const routeFiltered = profiles.filter(p => {
            if (!rank || !rank.managed_route || rank.managed_route.toLowerCase() === "all routes") return true;
            return p.managed_route && p.managed_route.toLowerCase().trim() === rank.managed_route.toLowerCase().trim();
        });

        res.json({ success: true, drivers: routeFiltered });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ==========================================
// GET SAFETY REPORTS / COMPLAINTS FOR RANK (SAFE QUERY)
// ==========================================
router.get("/reports/:rankId", async (req, res) => {
    try {
        const { rankId } = req.params;

        const { data: reports, error } = await supabase
            .from("driver_safety_reports")
            .select("*")
            .eq("rank_id", rankId)
            .order("created_at", { ascending: false });

        if (error) throw error;
        if (!reports || reports.length === 0) {
            return res.json({ success: true, reports: [] });
        }

        const driverIds = [...new Set(reports.map(r => r.driver_id).filter(Boolean))];
        let vehicleMap = {};

        if (driverIds.length > 0) {
            const { data: vehicles } = await supabase
                .from("vehicles")
                .select("driver_id, registration_number")
                .in("driver_id", driverIds);

            (vehicles || []).forEach(v => {
                vehicleMap[v.driver_id] = v.registration_number;
            });
        }

        const formattedReports = reports.map(r => ({
            id: r.id,
            driver_id: r.driver_id,
            violation_type: r.violation_type,
            description: r.description,
            transport_type: r.transport_type,
            commuter_name: r.commuter_name,
            evidence_url: r.evidence_url,
            status: r.status,
            created_at: r.created_at,
            vehicle_registration: vehicleMap[r.driver_id] || "Unknown Reg"
        }));

        return res.json({ success: true, reports: formattedReports });
    } catch (err) {
        console.error("Fetch rank safety reports error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// QUEUE MANAGEMENT
// ==========================================
router.get("/queue/:rankId", async (req, res) => {
    try {
        const adminId = req.query.adminId;
        const rank = await getAdminRank(adminId);

        const { data: queue } = await supabase.from("rank_queue").select("*").eq("rank_id", req.params.rankId).eq("queue_date", getTodayDate()).order("queue_position", { ascending: true });
        if (!queue || queue.length === 0) return res.json({ success: true, queue: [] });

        const profiles = await getDriverProfiles(queue.map(q => q.driver_id));
        const routeFilteredProfiles = profiles.filter(p => {
            if (!rank || !rank.managed_route || rank.managed_route.toLowerCase() === "all routes") return true;
            return p.managed_route && p.managed_route.toLowerCase().trim() === rank.managed_route.toLowerCase().trim();
        });
        const allowedIds = new Set(routeFilteredProfiles.map(p => p.driver_id));

        const filteredQueue = queue.filter(q => allowedIds.has(q.driver_id));

        const mappedQueue = filteredQueue.map(q => {
            const p = profiles.find(pr => pr.driver_id === q.driver_id) || {};
            return { id: q.id, taxi_id: q.vehicle_id, status: q.status, queue_position: q.queue_position, registration: p.vehicle_registration, driver_name: p.name };
        });
        res.json({ success: true, queue: mappedQueue });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get("/queue/drivers/:rankId/search", async (req, res) => {
    try {
        const adminId = req.query.adminId;
        const rank = await getAdminRank(adminId);

        const { data: members } = await supabase.from("rank_memberships").select("driver_id").eq("rank_id", req.params.rankId).eq("status", "APPROVED");
        const profiles = await getDriverProfiles((members || []).map(m => m.driver_id));

        const routeFiltered = profiles.filter(p => {
            if (!rank || !rank.managed_route || rank.managed_route.toLowerCase() === "all routes") return true;
            return p.managed_route && p.managed_route.toLowerCase().trim() === rank.managed_route.toLowerCase().trim();
        });

        const q = (req.query.q || "").toLowerCase();
        const filtered = q ? routeFiltered.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.vehicle_registration && p.vehicle_registration.toLowerCase().includes(q))) : routeFiltered;
        res.json({ success: true, drivers: filtered });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/queue/add", async (req, res) => {
    console.log("--> /queue/add payload received:", req.body);
    try {
        const { rank_id, driver_id, admin_id } = req.body;
        const gate = await verifyActiveRankAdmin(admin_id);
        if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });
        
        const { data: vehicle, error: vehError } = await supabase.from("vehicles").select("id").eq("driver_id", driver_id).maybeSingle();
        console.log("--> Vehicle lookup result:", vehicle, vehError);
        if (!vehicle) return res.status(404).json({ success: false, message: "Driver has no vehicle registered." });
        
        const today = getTodayDate();
        const { data: existing } = await supabase.from("rank_queue").select("id").eq("rank_id", rank_id).eq("vehicle_id", vehicle.id).eq("queue_date", today).maybeSingle();
        if (existing) return res.status(400).json({ success: false, message: "Taxi is already in today's queue." });
        
        const { data: lastItems, error: lastError } = await supabase
            .from("rank_queue")
            .select("queue_position")
            .eq("rank_id", rank_id)
            .eq("queue_date", today)
            .not("queue_position", "is", null)
            .order("queue_position", { ascending: false })
            .limit(1);

        if (lastError) throw lastError;

        let nextPos = 1;
        if (lastItems && lastItems.length > 0 && lastItems[0].queue_position != null) {
            nextPos = Number(lastItems[0].queue_position) + 1;
        }

        const { data, error } = await supabase.from("rank_queue").insert({ 
            rank_id, 
            driver_id, 
            vehicle_id: vehicle.id, 
            queue_date: today, 
            queue_position: nextPos, 
            status: "WAITING" 
        }).select().single();

        if (error) throw error;
        console.log("--> Successfully added to queue:", data);
        res.json({ success: true, message: "Added to queue.", queue: data });
    } catch (err) { 
        console.error("--> Error in /queue/add:", err.message);
        res.status(500).json({ success: false, message: err.message }); 
    }
});

router.post("/queue/taxi-out", async (req, res) => {
    console.log("--> /queue/taxi-out payload received:", req.body);
    try {
        const { queue_id, rank_id, admin_id } = req.body;
        const gate = await verifyActiveRankAdmin(admin_id);
        if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });
        
        const { data: qItem, error: fetchErr } = await supabase.from("rank_queue").select("*").eq("id", queue_id).single();
        if (fetchErr || !qItem) return res.status(404).json({ success: false, message: "Queue item not found." });

        // OPTIONAL: Lookup the admin's managed route destination if available
        let destinationRankId = null;
        const { data: adminData } = await supabase.from("users").select("managed_route").eq("id", admin_id).single();
        if (adminData && adminData.managed_route && adminData.managed_route.includes('→')) {
            const parts = adminData.managed_route.split('→').map(s => s.trim());
            const destName = parts[1];
            // Find the rank ID matching the destination name
            const { data: destRank } = await supabase.from("ranks").select("id").ilike("name", `%${destName}%`).limit(1).single();
            if (destRank) destinationRankId = destRank.id;
        }

        // 1. START LIVE GPS TRACKING TRIP WITH DESTINATION RESOLVED
        const { error: tripErr } = await supabase.from("active_dispatched_trips").insert([{
            driver_id: String(qItem.driver_id),
            vehicle_reg: String(qItem.vehicle_id || 'Unknown'),
            origin_rank_id: rank_id,
            destination_rank_id: destinationRankId, // Automatically filled from admin's route!
            status: 'DISPATCHED'
        }]);

        if (tripErr) {
            console.error("--> Error creating active trip:", tripErr.message);
        }

        // 2. Delete from queue table
        const { error: deleteErr } = await supabase.from("rank_queue").delete().eq("id", queue_id);
        if (deleteErr) throw deleteErr;

        const { data: remaining } = await supabase
            .from("rank_queue")
            .select("id")
            .eq("rank_id", qItem.rank_id)
            .eq("queue_date", qItem.queue_date)
            .order("queue_position", { ascending: true });

        for (let i = 0; i < (remaining || []).length; i++) {
            await supabase.from("rank_queue").update({ queue_position: i + 1 }).eq("id", remaining[i].id);
        }

        console.log("--> Successfully deleted taxi from queue & initialized GPS trip.");
        res.json({ success: true, message: "Taxi dispatched and tracking initialized." });
    } catch (err) { 
        console.error("--> Error in /queue/taxi-out:", err.message);
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// ==========================================
// RANK PHOTOS & SETTINGS
// ==========================================
router.post("/rank/photos", uploadPhotos.array("photos", 7), async (req, res) => {
    const gate = await verifyActiveRankAdmin(req.user.id);
    if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: "No files uploaded." });
    }

    const newUrls = req.files.map(file => `/uploads/${file.filename}`);

    const { data: rank } = await supabase.from("ranks").select("photo_urls").eq("id", req.body.rank_id).single();
    let currentUrls = rank.photo_urls || [];
    let combinedUrls = [...currentUrls, ...newUrls].slice(0, 7);

    const { data } = await supabase.from("ranks").update({ photo_urls: combinedUrls }).eq("id", req.body.rank_id).select().single();
    res.json({ success: true, photo_urls: combinedUrls, rank: data });
});

router.post("/rank/status", async (req, res) => {
    const { rank_id, is_open, admin_id } = req.body;
    const gate = await verifyActiveRankAdmin(admin_id);
    if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });

    const { data } = await supabase.from("ranks").update({ is_open }).eq("id", rank_id).select().single();
    res.json({ success: true, rank: data });
});

router.post("/rank/location", async (req, res) => {
    const { rank_id, latitude, longitude, admin_id } = req.body;
    const gate = await verifyActiveRankAdmin(admin_id);
    if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });

    const { data } = await supabase.from("ranks").update({ latitude, longitude }).eq("id", rank_id).select().single();
    res.json({ success: true, rank: data });
});

router.post("/rank/update", async (req, res) => {
    const { rank_id, address, description, admin_id, managed_route } = req.body;
    const gate = await verifyActiveRankAdmin(admin_id);
    if (!gate.allowed) return res.status(403).json({ success: false, message: gate.error });

    const updateData = {};
    if (address !== undefined) updateData.address = clean(address);
    if (description !== undefined) updateData.description = clean(description);

    if (Object.keys(updateData).length > 0) {
        await supabase.from("ranks").update(updateData).eq("id", rank_id);
    }

    const userUpdates = {};
    if (managed_route !== undefined) userUpdates.managed_route = clean(managed_route);

    if (Object.keys(userUpdates).length > 0) {
        await supabase.from("users").update(userUpdates).eq("id", admin_id);
    }

    res.json({ success: true, message: "Updated successfully." });
});

// ==========================================
// ROAD MANAGEMENT
// ==========================================
router.post("/roads", async (req, res) => {
    try {
        const { rank_id, road_name, route_type, coordinates } = req.body;
        const adminRank = await getAdminRank(req.user.id);
        if (!adminRank || String(adminRank.id) !== String(rank_id)) {
            return res.status(403).json({ success: false, message: "You may only manage roads for your assigned rank." });
        }
        const { data, error } = await supabase
            .from("rank_taxi_roads")
            .insert({ rank_id, road_name, route_type, coordinates })
            .select()
            .single();

        if (error) throw error;
        return res.json({ success: true, road: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/roads", async (req, res) => {
    try {
        const adminRank = await getAdminRank(req.user.id);
        if (!adminRank) return res.status(404).json({ success: false, message: "No assigned rank found." });
        const { data, error } = await supabase
            .from("rank_taxi_roads")
            .select("*")
            .eq("rank_id", adminRank.id);

        if (error) throw error;
        return res.json({ success: true, roads: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.delete("/roads/:roadId", async (req, res) => {
    try {
        const adminRank = await getAdminRank(req.user.id);
        if (!adminRank) return res.status(404).json({ success: false, message: "No assigned rank found." });

        const { data: road, error: lookupError } = await supabase
            .from("rank_taxi_roads")
            .select("id, rank_id")
            .eq("id", req.params.roadId)
            .maybeSingle();

        if (lookupError) throw lookupError;
        if (!road || String(road.rank_id) !== String(adminRank.id)) {
            return res.status(403).json({ success: false, message: "You may only remove roads from your assigned rank." });
        }

        const { error } = await supabase.from("rank_taxi_roads").delete().eq("id", road.id);
        if (error) throw error;
        return res.json({ success: true, message: "Road removed successfully." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
