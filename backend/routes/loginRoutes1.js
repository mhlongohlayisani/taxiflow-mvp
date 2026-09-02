const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const supabase = require("../config/supabase");

// ======================================================
// TAXIFLOW USER LOGIN (Strict Validation & Debug)
// ======================================================

router.post("/", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Please enter your username, email, or phone number and password."
            });
        }

        const searchVal = String(username).trim().toLowerCase();

        // 1. Smart Search: Find by Email, Username, or Phone natively in Supabase
        const { data: users, error: lookupError } = await supabase
            .from("users")
            .select("*")
            .or(`username.eq."${searchVal}",email.eq."${searchVal}",phone.eq."${searchVal}"`)
            .limit(1);

        if (lookupError) {
            console.error("Database error during login:", lookupError);
            return res.status(500).json({ success: false, message: "Database error during login." });
        }

        if (!users || users.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid credentials. User not found." });
        }

        const user = users[0];

        // 2. Check Password
        const passwordMatches = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: "Invalid credentials. Incorrect password." });
        }

        // 3. Check Account Status
        if (user.account_status !== "ACTIVE" && user.account_status !== "PENDING") {
            return res.status(403).json({ success: false, message: "Your account is suspended or inactive." });
        }

        // ==================================================
        // STRICT ROLE CHECK (Blocks old/unspecified roles)
        // ==================================================
        const allowedRoles = [
            "SUPER_ADMIN", 
            "BUS_RANK_ADMIN", 
            "TAXI_RANK_ADMIN", 
            "BUS_DRIVER", 
            "TAXI_DRIVER", 
            "USER", 
            "GENERAL_USER"
        ];

        // Clean up and format role string safely
        const userRole = String(user.role || "").trim().toUpperCase();
        
        // DEBUG: Look at your terminal console when logging in!
        console.log(`[LOGIN ATTEMPT] User: ${user.username} | Role in DB: "${userRole}"`);

        if (!allowedRoles.includes(userRole)) {
            console.log(`[BLOCKED] User ${user.username} blocked due to outdated role: "${userRole}"`);
            return res.status(403).json({ 
                success: false, 
                message: "Access denied: Your account role is outdated or unspecified. Please update your profile or re-register with a specific Taxi or Bus role." 
            });
        }

        // 4. Determine Redirect based on Specific Roles
        let redirect = "/user.html";
        
        if (userRole === "SUPER_ADMIN") {
            redirect = "/superadmin.html";
        } else if (userRole === "BUS_RANK_ADMIN") {
            redirect = "/bus-rank-admin.html";
        } else if (userRole === "TAXI_RANK_ADMIN") {
            redirect = "/rank-admin.html";
        } else if (userRole === "BUS_DRIVER" || userRole === "TAXI_DRIVER") {
            redirect = "/driver.html";
        }

        // 5. Success
        return res.status(200).json({
            success: true,
            message: "Signed in successfully.",
            redirect: redirect,
            user: {
                id: user.id,
                name: user.full_name || user.username,
                username: user.username,
                email: user.email,
                phone: user.phone,
                role: user.role,
                account_status: user.account_status
            }
        });

    } catch (error) {
        console.error("Login server error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed due to a server error.",
            error: error.message
        });
    }
});

module.exports = router;