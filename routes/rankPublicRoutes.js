const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

// ======================================================
// GET SINGLE PUBLIC RANK
// GET /api/rank/:rankId
//
// The rank-admin dashboard's "Public Preview" tab calls this
// directly (not /api/rank-admin/...), so it needs its own
// mount point in server.js: app.use("/api/rank", rankPublicRoutes)
// ======================================================

router.get("/:rankId", async (req, res) => {

    try {

        const { rankId } = req.params;

        const { data: rank, error } = await supabase
            .from("ranks")
            .select(`
                id,
                name,
                location,
                address,
                latitude,
                longitude,
                opening_time,
                closing_time,
                is_open,
                status,
                description,
                routes,
                phone,
                email,
                image_url
            `)
            .eq("id", rankId)
            .maybeSingle();

        if (error) {
            return res.status(500).json({
                success: false,
                message: "Failed to load rank.",
                error: error.message
            });
        }

        if (!rank) {
            return res.status(404).json({ success: false, message: "Rank not found." });
        }

        return res.json({ success: true, rank });

    }
    catch (error) {
        console.error("Public rank error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load rank.",
            error: error.message
        });
    }

});

// ======================================================
// GET PUBLIC RANK ROUTES
// GET /api/rank/:rankId/routes
// ======================================================

router.get("/:rankId/routes", async (req, res) => {

    try {

        const {
            rankId
        } = req.params;


        const {
            data: routes,
            error
        } = await supabase
            .from("rank_routes")
            .select(`
                id,
                rank_id,
                name,
                origin,
                destination,
                description,
                is_active,
                created_at,
                updated_at
            `)
            .eq("rank_id", rankId)
            .eq("is_active", true)
            .order("created_at", {
                ascending: true
            });


        if (error) {

            return res.status(500).json({

                success: false,

                message:
                    "Failed to load rank routes.",

                error:
                    error.message

            });

        }


        return res.json({

            success: true,

            routes:
                routes || []

        });

    }
    catch (error) {

        console.error(
            "Public rank routes error:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Failed to load rank routes.",

            error:
                error.message

        });

    }

});

module.exports = router;