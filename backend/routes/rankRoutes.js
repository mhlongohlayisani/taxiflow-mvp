const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { verifyToken, allowRoles } = require("../middleware/authenticateToken");

// ==========================================
// RANK TAXI ROADS (ADMIN DRAW & COMMUTER FETCH)
// ==========================================

router.post("/roads", verifyToken, allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"), async (req, res) => {
    try {
        const { rank_id, road_name, route_type, coordinates } = req.body;
        const { data, error } = await supabase
            .from("rank_taxi_roads")
            .insert({ rank_id, road_name, route_type: route_type || 'PRIMARY', coordinates })
            .select()
            .single();

        if (error) throw error;
        return res.json({ success: true, road: data });
    } catch (err) {
        console.error("Save road error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/roads", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("rank_taxi_roads")
            .select("*");

        if (error) throw error;
        return res.json({ success: true, roads: data });
    } catch (err) {
        console.error("Fetch roads error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.delete("/roads/:id", verifyToken, allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"), async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from("rank_taxi_roads")
            .delete()
            .eq("id", id);

        if (error) throw error;
        return res.json({ success: true, message: "Road removed successfully." });
    } catch (err) {
        console.error("Delete road error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ======================================================
// SEARCH RANKS BY NAME OR PLACE (Supports optional ?type=BUS or TAXI)
// ======================================================

router.get("/search", async (req, res) => {
    try {
        const query = (req.query.q || "").toLowerCase().trim();
        const rankType = req.query.type; // e.g. BUS or TAXI
        
        let dbQuery = supabase.from("ranks").select(`
            id, admin_id, name, address, description, latitude, longitude, opening_time, closing_time, is_open, photo_urls, rank_type, created_at
        `);
        
        if (rankType) {
            dbQuery = dbQuery.eq("rank_type", rankType);
        }

        if (query) {
            dbQuery = dbQuery.or(`name.ilike.%${query}%,address.ilike.%${query}%`);
        }

        const { data, error } = await dbQuery.order("name", { ascending: true });

        if (error) {
            console.error("Search ranks error:", error);
            return res.status(500).json({ success: false, message: "Failed to search taxi ranks", error: error.message });
        }

        return res.json({ success: true, ranks: data || [] });

    } catch (error) {
        console.error("Search ranks server error:", error);
        return res.status(500).json({ success: false, message: "Failed to search taxi ranks", error: error.message });
    }
});

// ======================================================
// GET ALL RANKS (Supports optional ?type=BUS or TAXI)
// ======================================================

router.get("/", async (req, res) => {
    try {
        const rankType = req.query.type; // e.g. BUS or TAXI
        let query = supabase.from("ranks").select(`
            id, admin_id, name, address, description, latitude, longitude, opening_time, closing_time, is_open, photo_urls, rank_type, created_at
        `).order("name", { ascending: true });

        if (rankType) {
            query = query.eq("rank_type", rankType);
        }

        const { data: ranks, error } = await query;

        if (error) {
            console.error("Supabase ranks error:", error);
            return res.status(500).json({ success: false, message: "Failed to load taxi ranks", error: error.message });
        }

        const { data: admins } = await supabase
            .from("users")
            .select("id, managed_route")
            .eq("role", "RANK_ADMIN");

        const enrichedRanks = (ranks || []).map(rank => {
            const admin = (admins || []).find(a => a.id === rank.admin_id);
            const routeName = (admin && admin.managed_route) ? admin.managed_route : "All Routes";
            
            return {
                ...rank,
                display_name: `${rank.name} — (Route: ${routeName})` 
            };
        });

        return res.json({ success: true, ranks: enrichedRanks });

    } catch (error) {
        console.error("Ranks route error:", error);
        return res.status(500).json({ success: false, message: "Failed to load taxi ranks", error: error.message });
    }
});

// ======================================================
// GET RANK BY ADMIN ID
// ======================================================

router.get("/admin/:adminId", verifyToken, allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"), async (req, res) => {
    try {
        const adminId = req.user.id;

        let { data: rank, error } = await supabase
            .from("ranks")
            .select("*")
            .eq("admin_id", adminId)
            .single();

        if (!rank) {
            const { data: userRecord } = await supabase
                .from("users")
                .select("existing_rank_id, managed_route")
                .eq("id", adminId)
                .single();

            if (userRecord && userRecord.existing_rank_id) {
                const { data: joinedRank } = await supabase
                    .from("ranks")
                    .select("*")
                    .eq("id", userRecord.existing_rank_id)
                    .single();
                
                if (joinedRank) {
                    rank = {
                        ...joinedRank,
                        managed_route: userRecord.managed_route
                    };
                }
            }
        }

        if (!rank) {
            return res.status(404).json({ success: false, message: "Taxi rank not found for this administrator" });
        }

        return res.json({ success: true, rank: rank });

    } catch (error) {
        console.error("Get admin rank error:", error);
        return res.status(500).json({ success: false, message: "Failed to load admin taxi rank", error: error.message });
    }
});

// ======================================================
// GET ONE TAXI RANK
// ======================================================

router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("ranks")
            .select(`
                id, admin_id, name, address, description, latitude, longitude, opening_time, closing_time, is_open, photo_urls, rank_type, created_at
            `)
            .eq("id", id)
            .single();

        if (error) {
            console.error("Get rank error:", error);
            return res.status(404).json({ success: false, message: "Taxi rank not found", error: error.message });
        }

        return res.json({ success: true, rank: data });

    } catch (error) {
        console.error("Get rank server error:", error);
        return res.status(500).json({ success: false, message: "Failed to load taxi rank", error: error.message });
    }
});

// ======================================================
// OPEN TAXI RANK
// ======================================================

router.patch("/:id/open", verifyToken, allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"), async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("ranks")
            .update({ is_open: true })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Open rank error:", error);
            return res.status(500).json({ success: false, message: "Failed to open taxi rank", error: error.message });
        }

        return res.json({ success: true, message: "Taxi rank is now open", rank: data });

    } catch (error) {
        console.error("Open rank server error:", error);
        return res.status(500).json({ success: false, message: "Failed to open taxi rank", error: error.message });
    }
});

// ======================================================
// CLOSE TAXI RANK
// ======================================================

router.patch("/:id/close", verifyToken, allowRoles("TAXI_RANK_ADMIN", "BUS_RANK_ADMIN"), async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("ranks")
            .update({ is_open: false })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Close rank error:", error);
            return res.status(500).json({ success: false, message: "Failed to close taxi rank", error: error.message });
        }

        return res.json({ success: true, message: "Taxi rank is now closed", rank: data });

    } catch (error) {
        console.error("Close rank server error:", error);
        return res.status(500).json({ success: false, message: "Failed to load close rank", error: error.message });
    }
});

// ======================================================
// COMMUTER LIVE TRACKING
// ======================================================

router.post("/commuter/live", verifyToken, allowRoles("USER", "GENERAL_USER"), async (req, res) => {
    try {
        const { name, destination, latitude, longitude } = req.body;
        const { data, error } = await supabase
            .from("live_commuters")
            .upsert({
                name: name || "Commuter",
                destination,
                latitude,
                longitude,
                updated_at: new Date().toISOString()
            }, { onConflict: "name" })
            .select()
            .single();
        if (error) throw error;
        return res.json({ success: true, commuter: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/commuter/live/cancel", verifyToken, allowRoles("USER", "GENERAL_USER"), async (req, res) => {
    try {
        const { name } = req.body;
        await supabase.from("live_commuters").delete().eq("name", name);
        return res.json({ success: true, message: "Commuter is no longer live" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/commuter/live/active", async (req, res) => {
    try {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from("live_commuters")
            .select("*")
            .gte("updated_at", cutoff);
        if (error) throw error;
        return res.json({ success: true, commuters: data || [] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
