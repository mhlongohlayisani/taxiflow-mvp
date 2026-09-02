require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const supabase = require("./config/supabase");

const setupRoutes = require("./routes/setupRoutes");
const rankRoutes = require("./routes/rankRoutes");
const registerRoutes = require("./routes/registerRoutes");
const loginRoutes = require("./routes/loginRoutes");
const adminRoutes = require("./routes/adminRoutes");
const rankAdminRoutes = require("./routes/rankAdminRoutes");
const rankPublicRoutes = require("./routes/rankPublicRoutes");
const driverRoutes = require("./routes/driverRoutes");
const { verifyToken, allowRoles } = require("./middleware/authenticateToken");

const app = express();

const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors());
app.use(express.json());

// ==========================================
// UPLOADED FILES (rank photos)
// ==========================================
app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

// ==========================================
// API ROUTES
// ==========================================

app.use("/api/register", registerRoutes);
app.use("/api/setup", setupRoutes);
app.use("/api/ranks", rankRoutes);
app.use("/api/login", loginRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rank-admin", rankAdminRoutes);
app.use("/api/rank", rankPublicRoutes); 
app.use("/api/drivers/panic", verifyToken);
app.use("/api/drivers", driverRoutes);

// Corrected file reference here:
const commuterRoutes = require("./routes/commuterRoutes");
app.use("/api/commuter", commuterRoutes);

// Chat endpoints declared below are also private rank-admin endpoints.
app.use(
    "/api/rank-admin/chat",
    verifyToken,
    allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"),
    (req, res, next) => {
        if (req.body && typeof req.body === "object") {
            req.body.admin_id = req.user.id;
            req.body.sender_admin_id = req.user.id;
        }
        next();
    }
);

// ==========================================
// FRONTEND
// ==========================================

app.use(
    express.static(
        path.join(__dirname, "../frontend")
    )
);

// ==========================================
// BASIC STATUS
// ==========================================

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        application: "TaxiFlow",
        message: "TaxiFlow backend is running",
        version: "MVP 1.0"
    });
});

// ==========================================
// SUPABASE CONNECTION TEST
// ==========================================

app.get("/api/database-test", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("ranks")
            .select("id")
            .limit(1);

        if (error) {
            console.error("Supabase error:", error);
            return res.status(500).json({
                success: false,
                message: "Supabase connection failed",
                error: error.message
            });
        }

        res.json({
            success: true,
            message: "TaxiFlow is connected to Supabase",
            database: "ONLINE"
        });

    } catch (error) {
        console.error("Database test error:", error);
        res.status(500).json({
            success: false,
            message: "Database test failed",
            error: error.message
        });
    }
});

// ==========================================
// INTER-RANK CHAT DISPATCH ROUTES
// ==========================================

// 1. Get all other ranks except the current user's rank
// 1. Get all other TAXI ranks except the current user's rank (Strictly exclude Bus Ranks)
app.get('/api/rank-admin/chat/ranks/other/:currentRankId', async (req, res) => {
    const currentRankId = req.params.currentRankId;
    try {
        const { data, error } = await supabase
            .from('ranks')
            .select('id, name, address')
            .neq('id', currentRankId)
            .not('name', 'ilike', '%bus%'); // <--- Excludes any rank with "bus" in its name

        if (error) throw error;
        res.json({ success: true, ranks: data });
    } catch (err) {
        console.error('Error fetching other ranks for chat:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch other ranks.' });
    }
});

// Strict Opposite Route Partner Fetcher (e.g. BOYN -> nkowankowa matches nkowankowa -> boyn)
app.get('/api/rank-admin/chat/ranks/opposite/:currentRankId', async (req, res) => {
    const currentRankId = req.params.currentRankId;
    try {
        const { data: currentAdmin, error: adminErr } = await supabase
            .from('users')
            .select('managed_route')
            .eq('rank_id', currentRankId)
            .single();

        if (adminErr || !currentAdmin || !currentAdmin.managed_route || !currentAdmin.managed_route.includes('→')) {
            return res.json({ success: true, ranks: [] });
        }

        // Normalize and reverse the route cleanly (e.g. "BOYN → nkowankowa" becomes "nkowankowa → boyn")
        const parts = currentAdmin.managed_route.split('→').map(s => s.trim().toLowerCase());
        const origin = parts[0];
        const destination = parts[1];
        const strictOppositeRoute = `${destination} → ${origin}`;

        // Case-insensitive query using ILIKE
        const { data: matchingUsers, error: matchErr } = await supabase
            .from('users')
            .select('rank_id, managed_route, role, ranks(id, name, address)')
            .eq('role', 'TAXI_RANK_ADMIN')
            .ilike('managed_route', strictOppositeRoute)
            .not('managed_route', 'ilike', '%bus%')
            .neq('rank_id', currentRankId);

        if (matchErr) throw matchErr;

        const validRanks = [];
        if (matchingUsers) {
            matchingUsers.forEach(u => {
                if (u.ranks && !validRanks.some(r => r.id === u.ranks.id)) {
                    validRanks.push(u.ranks);
                }
            });
        }

        res.json({ success: true, ranks: validRanks });
    } catch (err) {
        console.error('Error fetching opposite route partner:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch opposite route partner.' });
    }
});

// 2. Get messages between two specific ranks
app.get('/api/rank-admin/chat/chat/:rankA/:rankB', async (req, res) => {
    const { rankA, rankB } = req.params;
    try {
        const { data, error } = await supabase
            .from('rank_chats')
            .select('*')
            .or(`and(sender_rank_id.eq.${rankA},receiver_rank_id.eq.${rankB}),and(sender_rank_id.eq.${rankB},receiver_rank_id.eq.${rankA})`)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, messages: data });
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
    }
});

// 3. Send a message to another rank
app.post('/api/rank-admin/chat/chat/send', async (req, res) => {
    const { sender_rank_id, sender_admin_id, receiver_rank_id, message } = req.body;
    try {
        const { data, error } = await supabase
            .from('rank_chats')
            .insert([{ sender_rank_id, sender_admin_id, receiver_rank_id, message }])
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, message: data });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
});



// 1. Get or Create a Route Room between two ranks
app.post('/api/rank-admin/chat/room', async (req, res) => {
    const { route_name, initiator_rank_id, target_rank_id } = req.body;
    try {
        // Check if a room already exists for this route/pair
        let { data: room, error } = await supabase
            .from('rank_chat_rooms')
            .select('*')
            .or(`and(initiator_rank_id.eq.${initiator_rank_id},target_rank_id.eq.${target_rank_id}),and(initiator_rank_id.eq.${target_rank_id},target_rank_id.eq.${initiator_rank_id})`)
            .single();

        if (!room) {
            // Create a new locked room in WAITING state
            const { data: newRoom, error: createErr } = await supabase
                .from('rank_chat_rooms')
                .insert([{ route_name, initiator_rank_id, target_rank_id, status: 'WAITING' }])
                .select()
                .single();
            if (createErr) throw createErr;
            room = newRoom;
        }

        res.json({ success: true, room });
    } catch (err) {
        console.error('Error creating/fetching room:', err);
        res.status(500).json({ success: false, message: 'Failed to initialize chat room.' });
    }
});

// 2. Join/Unlock a Room (Target marshal accepts)
app.post('/api/rank-admin/chat/room/join', async (req, res) => {
    const { room_id } = req.body;
    try {
        const { data, error } = await supabase
            .from('rank_chat_rooms')
            .update({ status: 'ACTIVE' })
            .eq('id', room_id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, room: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to join room.' });
    }
});

// 3. Get messages for a specific room
app.get('/api/rank-admin/chat/messages/:roomId', async (req, res) => {
    const roomId = req.params.roomId;
    try {
        const { data, error } = await supabase
            .from('rank_chat_messages')
            .select('*')
            .eq('room_id', roomId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, messages: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
    }
});

// 4. Send message to room (Only works if ACTIVE)
app.post('/api/rank-admin/chat/messages/send', async (req, res) => {
    const { room_id, sender_rank_id, sender_admin_id, message } = req.body;
    try {
        // Verify room status is ACTIVE
        const { data: room } = await supabase
            .from('rank_chat_rooms')
            .select('status')
            .eq('id', room_id)
            .single();

        if (!room || room.status !== 'ACTIVE') {
            return res.status(403).json({ success: false, message: 'Room is locked until the destination marshal joins.' });
        }

        const { data, error } = await supabase
            .from('rank_chat_messages')
            .insert([{ room_id, sender_rank_id, sender_admin_id, message }])
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, message: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
});

// AUTO-MATCH ROUTE ROOM: Finds or creates a room for opposite route pairs (e.g., A->B matches B->A)
app.post('/api/rank-admin/chat/auto-match-room', async (req, res) => {
    const { admin_id, rank_id, managed_route } = req.body;

    if (!managed_route || !managed_route.includes('→')) {
        return res.status(400).json({ success: false, message: 'Invalid or missing managed route format (use A → B).' });
    }

    try {
        const parts = managed_route.split('→').map(s => s.trim().toLowerCase());
        const origin = parts[0];
        const destination = parts[1];
        const oppositeRoutePattern = `${destination} → ${origin}`;

        const { data: oppositeAdmins, error: adminErr } = await supabase
            .from('users')
            .select('id, rank_id, managed_route, role')
            .eq('role', 'TAXI_RANK_ADMIN')
            .ilike('managed_route', oppositeRoutePattern)
            .not('managed_route', 'ilike', '%bus%')
            .neq('id', admin_id);

        if (adminErr) throw adminErr;

        if (!oppositeAdmins || oppositeAdmins.length === 0) {
            let { data: existingRoom } = await supabase
                .from('rank_chat_rooms')
                .select('*')
                .ilike('route_name', managed_route)
                .single();

            if (!existingRoom) {
                const { data: newRoom, error: createErr } = await supabase
                    .from('rank_chat_rooms')
                    .insert([{
                        route_name: managed_route.toLowerCase(), // Store uniformly in lowercase
                        initiator_rank_id: rank_id,
                        target_rank_id: rank_id,
                        status: 'WAITING'
                    }])
                    .select()
                    .single();
                if (createErr) throw createErr;
                existingRoom = newRoom;
            }
            return res.json({ success: true, room: existingRoom, status: 'WAITING', message: 'Waiting for opposite route marshal to join.' });
        }

        const partner = oppositeAdmins[0];
        const targetRankId = partner.rank_id;

        let { data: room, error: roomErr } = await supabase
            .from('rank_chat_rooms')
            .select('*')
            .or(`and(initiator_rank_id.eq.${rank_id},target_rank_id.eq.${targetRankId}),and(initiator_rank_id.eq.${targetRankId},target_rank_id.eq.${rank_id})`)
            .single();

        if (!room) {
            const { data: createdRoom, error: createErr } = await supabase
                .from('rank_chat_rooms')
                .insert([{
                    route_name: `${managed_route.toLowerCase()} & ${oppositeRoutePattern}`,
                    initiator_rank_id: rank_id,
                    target_rank_id: targetRankId,
                    status: 'ACTIVE'
                }])
                .select()
                .single();

            if (createErr) throw createErr;
            room = createdRoom;
        } else if (room.status === 'WAITING') {
            await supabase
                .from('rank_chat_rooms')
                .update({ status: 'ACTIVE' })
                .eq('id', room.id);
            room.status = 'ACTIVE';
        }

        res.json({ success: true, room, status: 'ACTIVE', message: 'Successfully matched with opposite route marshal!' });

    } catch (err) {
        console.error('Auto-match room error:', err);
        res.status(500).json({ success: false, message: 'Server error matching route room.' });
    }
});


// Function to calculate distance in meters between two GPS coordinates
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
}

// GPS PING & MONITORING ROUTE
app.post('/api/rank-admin/trips/ping-gps', async (req, res) => {
    const { trip_id, latitude, longitude } = req.body;

    try {
        // 1. Fetch trip and destination rank coordinates
        const { data: trip, error: tripErr } = await supabase
            .from('active_dispatched_trips')
            .select('*, ranks!active_dispatched_trips_destination_rank_id_fkey(latitude, longitude, name)')
            .eq('id', trip_id)
            .single();

        if (tripErr || !trip) return res.status(404).json({ success: false, message: 'Trip not found.' });

        const destLat = trip.ranks?.latitude;
        const destLon = trip.ranks?.longitude;
        
        let statusUpdate = trip.status;
        let notificationMessage = null;

        // 2. Check 1000m Proximity Arrival Rule
        if (destLat && destLon) {
            const distanceMeters = calculateDistanceMeters(latitude, longitude, destLat, destLon);
            if (distanceMeters <= 1000 && trip.status === 'DISPATCHED') {
                statusUpdate = 'ARRIVED';
                notificationMessage = `Taxi ${trip.vehicle_reg} is approaching destination (${Math.round(distanceMeters)}m away)!`;
            }
        }

        // 3. Check Stall / Unplanned Stop Rule (e.g. no movement for > 10 minutes while dispatched)
        const lastUpdatedTime = new Date(trip.last_updated).getTime();
        const now = new Date().getTime();
        const minutesStopped = (now - lastUpdatedTime) / 60000;

        if (trip.last_latitude && trip.last_longitude) {
            const movedDistance = calculateDistanceMeters(latitude, longitude, trip.last_latitude, trip.last_longitude);
            // If it moved less than 20 meters in 8+ minutes, flag as stalled
            if (movedDistance < 20 && minutesStopped >= 8 && trip.status === 'DISPATCHED') {
                statusUpdate = 'STALLED_ALERT';
                notificationMessage = `⚠️ STALL ALERT: Taxi ${trip.vehicle_reg} has been stationary for ${Math.round(minutesStopped)} minutes without reaching destination!`;
                
                // Automatically log a safety report for the rank admin
                await supabase.from('safety_reports').insert([{
                    rank_id: trip.origin_rank_id,
                    reported_by: 'GPS_MONITOR_BOT',
                    description: `Automated Stall Alert: Vehicle ${trip.vehicle_reg} stalled on route for over ${Math.round(minutesStopped)} minutes.`
                }]);
            }
        }

        // 4. Update trip record with latest GPS coordinates
        await supabase
            .from('active_dispatched_trips')
            .update({
                last_latitude: latitude,
                last_longitude: longitude,
                last_updated: new Date(),
                status: statusUpdate
            })
            .eq('id', trip_id);

        res.json({ success: true, status: statusUpdate, alert: notificationMessage });
    } catch (err) {
        console.error('GPS ping error:', err);
        res.status(500).json({ success: false, message: 'Failed to process GPS ping.' });
    }
});


// START A DISPATCHED TRIP (Activates live GPS tracking)
app.post('/api/rank-admin/trips/start', async (req, res) => {
    const { driver_id, vehicle_reg, origin_rank_id, destination_rank_id } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('active_dispatched_trips')
            .insert([{
                driver_id: String(driver_id),
                vehicle_reg: String(vehicle_reg),
                origin_rank_id: origin_rank_id,
                destination_rank_id: destination_rank_id || null,
                status: 'DISPATCHED'
            }])
            .select()
            .single();

        if (error) throw error;
        
        res.json({ success: true, trip: data });
    } catch (err) {
        console.error('Error starting trip tracking:', err);
        res.status(500).json({ success: false, message: 'Failed to record trip dispatch.' });
    }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log("");
    console.log("====================================");
    console.log("        TAXIFLOW MVP SERVER");
    console.log("====================================");
    console.log("");
    console.log(`Server: http://localhost:${PORT}`);
    console.log("Status: ONLINE");
    console.log("");
    console.log("====================================");
});
