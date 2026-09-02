const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = express.Router();
const supabase = require("../config/supabase");
const { getJwtSecret } = require("../middleware/authenticateToken");

router.post("/", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Please enter your username, email, or phone number and password." });
        }

        const searchVal = String(username).trim().toLowerCase();
        const { data: users, error: lookupError } = await supabase
            .from("users")
            .select("*")
            .or(`username.eq."${searchVal}",email.eq."${searchVal}",phone.eq."${searchVal}"`)
            .limit(1);

        if (lookupError) {
            console.error("Database error during login:", lookupError);
            return res.status(500).json({ success: false, message: "Database error during login." });
        }

        const user = users?.[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Invalid username or password." });
        }

        if (user.account_status !== "ACTIVE" && user.account_status !== "PENDING") {
            return res.status(403).json({ success: false, message: "Your account is suspended or inactive." });
        }

        const allowedRoles = ["SUPER_ADMIN", "BUS_RANK_ADMIN", "TAXI_RANK_ADMIN", "BUS_DRIVER", "TAXI_DRIVER", "USER", "GENERAL_USER"];
        const userRole = String(user.role || "").trim().toUpperCase();
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ success: false, message: "Access denied: Your account role is outdated or unspecified." });
        }

        const redirects = {
            SUPER_ADMIN: "/superadmin.html",
            BUS_RANK_ADMIN: "/bus-rank-admin.html",
            TAXI_RANK_ADMIN: "/rank-admin.html",
            BUS_DRIVER: "/driver.html",
            TAXI_DRIVER: "/driver.html"
        };

        const token = jwt.sign(
            { id: user.id, role: userRole, email: user.email || null },
            getJwtSecret(),
            {
                algorithm: "HS256",
                expiresIn: process.env.JWT_EXPIRES_IN || "8h",
                issuer: "taxiflow-api",
                audience: "taxiflow-web",
                subject: String(user.id)
            }
        );

        return res.status(200).json({
            success: true,
            message: "Signed in successfully.",
            token,
            expiresIn: process.env.JWT_EXPIRES_IN || "8h",
            redirect: redirects[userRole] || "/user.html",
            user: {
                id: user.id,
                name: user.full_name || user.username,
                username: user.username,
                email: user.email,
                phone: user.phone,
                role: userRole,
                account_status: user.account_status
            }
        });
    } catch (error) {
        console.error("Login server error:", error);
        return res.status(500).json({ success: false, message: "Login failed due to a server error." });
    }
});

module.exports = router;
