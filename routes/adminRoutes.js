const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

// ======================================================
// SUPER ADMIN DASHBOARD STATS (Taxi & Bus Support)
// ======================================================

router.get("/dashboard", async (req, res) => {
    try {
        const { data: users, error: usersError } = await supabase
            .from("users")
            .select("id, role, account_status");

        if (usersError) throw usersError;

        const { data: ranks, error: ranksError } = await supabase
            .from("ranks")
            .select("id, is_open");

        if (ranksError) throw ranksError;

        const { count: totalTaxis } = await supabase
            .from("vehicles")
            .select("id", { count: "exact", head: true });

        const totalRanks = ranks.length;
        const openRanks = ranks.filter(r => r.is_open === true).length;

        // Drivers (Taxi & Bus Drivers)
        const driverRoles = ["TAXI_DRIVER", "BUS_DRIVER", "DRIVER"];
        const drivers = users.filter(u => driverRoles.includes(String(u.role || "").toUpperCase()));
        const totalDrivers = drivers.length;
        const pendingDrivers = drivers.filter(d => d.account_status === "PENDING").length;
        const activeDrivers = drivers.filter(d => d.account_status === "ACTIVE").length;
        const suspendedDrivers = drivers.filter(d => d.account_status === "SUSPENDED").length;

        // Rank Admins (Taxi & Bus Rank Admins)
        const adminRoles = ["TAXI_RANK_ADMIN", "BUS_RANK_ADMIN", "RANK_ADMIN"];
        const rankAdmins = users.filter(u => adminRoles.includes(String(u.role || "").toUpperCase()));
        const totalRankAdmins = rankAdmins.length;
        const pendingRankAdmins = rankAdmins.filter(a => a.account_status === "PENDING").length;
        const activeRankAdmins = rankAdmins.filter(a => a.account_status === "ACTIVE").length;

        const commuters = users.filter(u => {
            const r = String(u.role || "").toUpperCase();
            return r === "USER" || r === "GENERAL_USER";
        });

        return res.json({
            success: true,
            stats: {
                ranks: {
                    total: totalRanks,
                    open: openRanks,
                    closed: totalRanks - openRanks
                },
                drivers: {
                    total: totalDrivers,
                    pending: pendingDrivers,
                    active: activeDrivers,
                    suspended: suspendedDrivers
                },
                rankAdmins: {
                    total: totalRankAdmins,
                    pending: pendingRankAdmins,
                    active: activeRankAdmins
                },
                users: {
                    total: commuters.length
                },
                taxis: {
                    total: totalTaxis || 0
                }
            }
        });

    } catch (error) {
        console.error("Super Admin dashboard error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load Super Admin dashboard",
            error: error.message
        });
    }
});

// ======================================================
// GET ALL RANK ADMINS (Taxi & Bus)
// ======================================================

router.get("/rank-admins", async (req, res) => {
    try {
        const adminRoles = ["TAXI_RANK_ADMIN", "BUS_RANK_ADMIN", "RANK_ADMIN"];

        const { data: admins, error: adminError } = await supabase
            .from("users")
            .select(`id, full_name, username, email, phone, role, account_status, managed_route, existing_rank_id, created_at`)
            .in("role", adminRoles)
            .order("created_at", { ascending: false });

        if (adminError) throw adminError;

        const { data: ranks, error: rankError } = await supabase
            .from("ranks")
            .select("id, admin_id, name, address, is_open");

        if (rankError) throw rankError;

        const rankMapById = {};
        const rankMapByAdminId = {};
        (ranks || []).forEach(r => {
            rankMapById[r.id] = r;
            rankMapByAdminId[r.admin_id] = r;
        });

        const finalAdmins = (admins || []).map(admin => {
            let matchedRank = rankMapByAdminId[admin.id] || rankMapById[admin.existing_rank_id] || null;
            return {
                ...admin,
                rank: matchedRank
            };
        });

        return res.json({
            success: true,
            rankAdmins: finalAdmins
        });

    } catch (error) {
        console.error("Get rank admins error:", error);
        return res.status(500).json({ success: false, message: "Failed to load rank admins", error: error.message });
    }
});

// ======================================================
// UPDATE ACCOUNT STATUS (Universal Group Mapping)
// ======================================================
async function updateAccountStatus(userId, roleGroup, status, res) {
    try {
        let targetRoles = [];
        if (roleGroup === "DRIVER") {
            targetRoles = ["TAXI_DRIVER", "BUS_DRIVER", "DRIVER"];
        } else if (roleGroup === "RANK_ADMIN") {
            targetRoles = ["TAXI_RANK_ADMIN", "BUS_RANK_ADMIN", "RANK_ADMIN"];
        } else {
            targetRoles = [roleGroup];
        }

        const { data, error } = await supabase
            .from("users")
            .update({
                account_status: status,
                updated_at: new Date().toISOString()
            })
            .eq("id", userId)
            .in("role", targetRoles)
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: `Account has been marked as ${status}.`,
            user: data
        });
    } catch (error) {
        console.error(`Update status error for group ${roleGroup}:`, error);
        return res.status(500).json({ success: false, message: `Failed to update account status.`, error: error.message });
    }
}

// Rank Admin Actions
router.patch("/rank-admins/:id/approve", (req, res) => updateAccountStatus(req.params.id, "RANK_ADMIN", "ACTIVE", res));
router.patch("/rank-admins/:id/reject", (req, res) => updateAccountStatus(req.params.id, "RANK_ADMIN", "REJECTED", res));
router.patch("/rank-admins/:id/suspend", (req, res) => updateAccountStatus(req.params.id, "RANK_ADMIN", "SUSPENDED", res));
router.patch("/rank-admins/:id/restore", (req, res) => updateAccountStatus(req.params.id, "RANK_ADMIN", "ACTIVE", res));

// ======================================================
// GET ALL DRIVERS (Taxi & Bus)
// ======================================================

router.get("/drivers", async (req, res) => {
    try {
        const driverRoles = ["TAXI_DRIVER", "BUS_DRIVER", "DRIVER"];

        const { data: drivers, error: driverError } = await supabase
            .from("users")
            .select(`id, full_name, username, email, phone, role, account_status, managed_route, created_at`)
            .in("role", driverRoles)
            .order("created_at", { ascending: false });

        if (driverError) throw driverError;

        const { data: vehicles, error: vehicleError } = await supabase
            .from("vehicles")
            .select("id, driver_id, registration_number, passenger_capacity");

        if (vehicleError) throw vehicleError;

        const vehicleMap = {};
        (vehicles || []).forEach(v => vehicleMap[v.driver_id] = v);

        const finalDrivers = (drivers || []).map(driver => ({
            ...driver,
            vehicle: vehicleMap[driver.id] || null
        }));

        return res.json({
            success: true,
            drivers: finalDrivers
        });

    } catch (error) {
        console.error("Get drivers error:", error);
        return res.status(500).json({ success: false, message: "Failed to load drivers", error: error.message });
    }
});

// Driver Actions
router.patch("/drivers/:id/approve", (req, res) => updateAccountStatus(req.params.id, "DRIVER", "ACTIVE", res));
router.patch("/drivers/:id/reject", (req, res) => updateAccountStatus(req.params.id, "DRIVER", "REJECTED", res));
router.patch("/drivers/:id/suspend", (req, res) => updateAccountStatus(req.params.id, "DRIVER", "SUSPENDED", res));
router.patch("/drivers/:id/restore", (req, res) => updateAccountStatus(req.params.id, "DRIVER", "ACTIVE", res));

module.exports = router;