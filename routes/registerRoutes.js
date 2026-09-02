const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const supabase = require("../config/supabase");

// ======================================================
// TAXIFLOW USER REGISTRATION
// ======================================================

router.post("/", async (req, res) => {
    try {
        const {
            accountType,
            name,
            full_name,
            phone,
            email,
            username,
            password,

            // DRIVER specific (Taxi & Bus)
            numberPlate,
            taxiNumber,
            taxiCapacity,
            rankId1,
            rankId2,
            driverRoute,

            // RANK ADMIN specific (Taxi & Bus)
            rankSetupMode, // "CREATE" or "JOIN"
            existingRankId, 
            rankName,
            rankAddress,
            openingTime,
            closingTime,
            rankPhone,
            whatsappNumber,
            routesServed
        } = req.body;

        // ==================================================
        // 1. BASIC VALIDATION
        // ==================================================
        if (!accountType || (!name && !full_name) || !phone || !username || !password) {
            return res.status(400).json({
                success: false,
                message: "Please complete all required fields."
            });
        }

        const allowedTypes = ["GENERAL_USER", "USER", "DRIVER", "BUS_DRIVER", "RANK_ADMIN", "BUS_RANK_ADMIN", "TAXI_DRIVER", "TAXI_RANK_ADMIN"];
        if (!allowedTypes.includes(accountType)) {
            return res.status(400).json({ success: false, message: "Invalid account type." });
        }

        // ==================================================
        // 2. CHECK IF USERNAME OR PHONE ALREADY EXISTS
        // ==================================================
        const cleanUsername = String(username).toLowerCase().trim();
        const cleanPhone = String(phone).trim();

        const { data: existingUsers, error: checkError } = await supabase
            .from("users")
            .select("username, phone")
            .or(`username.eq."${cleanUsername}",phone.eq."${cleanPhone}"`)
            .limit(1);

        if (checkError) throw checkError;

        if (existingUsers && existingUsers.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: "That username or phone number is already taken. Please choose another." 
            });
        }

        // ==================================================
        // 3. PREPARE USER DATA WITH EXPLICIT ROLES
        // ==================================================
        const password_hash = await bcrypt.hash(password, 12);
        
        const isGeneralUser = accountType === "GENERAL_USER" || accountType === "USER";
        
        // Map account types precisely to distinct database roles
        let dbRole = accountType;
        if (accountType === "DRIVER") dbRole = "TAXI_DRIVER";
        if (accountType === "BUS_DRIVER") dbRole = "BUS_DRIVER";
        if (accountType === "RANK_ADMIN") dbRole = "TAXI_RANK_ADMIN";
        if (accountType === "BUS_RANK_ADMIN") dbRole = "BUS_RANK_ADMIN";

        const account_status = (isGeneralUser || dbRole.includes("DRIVER")) ? "ACTIVE" : "PENDING";
        const role = isGeneralUser ? "USER" : dbRole;

        // ==================================================
        // 4. CREATE USER 
        // ==================================================
        const userInsertPayload = {
            full_name: full_name || name,
            username: cleanUsername,
            email: email ? String(email).toLowerCase().trim() : null,
            phone: cleanPhone,
            password_hash: password_hash,
            role: role, // Saves precisely as TAXI_DRIVER, BUS_DRIVER, TAXI_RANK_ADMIN, or BUS_RANK_ADMIN
            account_status: account_status,
            managed_route: role.includes("RANK_ADMIN") ? routesServed : (role.includes("DRIVER") ? driverRoute : null)
        };

        if (role.includes("RANK_ADMIN") && rankSetupMode === "JOIN" && existingRankId) {
            userInsertPayload.existing_rank_id = existingRankId;
        }

        const { data: user, error: userError } = await supabase
            .from("users")
            .insert(userInsertPayload)
            .select()
            .single();

        if (userError) {
            console.error("User creation error:", userError);
            if (userError.code === '23505') {
                return res.status(409).json({ 
                    success: false, 
                    message: "Database Error: Username or Phone is taken." 
                });
            }
            return res.status(500).json({ success: false, message: "Failed to create account.", error: userError.message });
        }

        // ==================================================
        // 5. GENERAL USER SUCCESS
        // ==================================================
        if (isGeneralUser) {
            return res.status(201).json({
                success: true,
                message: "Account created successfully.",
                user: { id: user.id, name: user.full_name, username: user.username, role: user.role }
            });
        }

        // ==================================================
        // 6. DRIVER REGISTRATION (Taxi & Bus Drivers)
        // ==================================================
        if (role === "TAXI_DRIVER" || role === "BUS_DRIVER") {
            if (!rankId1) {
                await supabase.from("users").delete().eq("id", user.id);
                return res.status(400).json({ success: false, message: "Please select your primary rank." });
            }

            const capacity = taxiCapacity ? Number(taxiCapacity) : (role === "BUS_DRIVER" ? 45 : 15);
            const { error: vehicleError } = await supabase
                .from("vehicles")
                .insert({
                    driver_id: user.id,
                    registration_number: numberPlate || taxiNumber || "PENDING",
                    passenger_capacity: capacity,
                    seats_available: capacity,
                    availability_status: "NOT_FULL",
                    vehicle_type: role === "BUS_DRIVER" ? "BUS" : "TAXI" // Clearly distinguishes vehicle type
                });

            if (vehicleError) {
                console.error("DETAILED VEHICLE ERROR:", vehicleError);
                await supabase.from("users").delete().eq("id", user.id);
                return res.status(500).json({ success: false, message: `Failed to register vehicle: ${vehicleError.message}` });
            }

            const memberships = [{ rank_id: rankId1, driver_id: user.id, status: "PENDING" }];
            if (rankId2 && rankId2 !== rankId1) {
                memberships.push({ rank_id: rankId2, driver_id: user.id, status: "PENDING" });
            }

            const { error: membershipError } = await supabase
                .from("rank_memberships")
                .insert(memberships);

            if (membershipError) {
                console.error("DETAILED MEMBERSHIP ERROR:", membershipError);
                await supabase.from("users").delete().eq("id", user.id);
                return res.status(500).json({ success: false, message: "Driver created but rank application failed.", error: membershipError.message });
            }

            const driverLabel = role === "BUS_DRIVER" ? "Bus driver" : "Taxi driver";
            return res.status(201).json({
                success: true,
                message: `${driverLabel} account created! Awaiting Rank Admin approval for your selected ranks.`
            });
        }

        // ==================================================
        // 7. RANK ADMIN REGISTRATION (Taxi & Bus Ranks)
        // ==================================================
        if (role === "TAXI_RANK_ADMIN" || role === "BUS_RANK_ADMIN") {
            if (rankSetupMode !== "JOIN") {
                if (!rankName) {
                    await supabase.from("users").delete().eq("id", user.id);
                    return res.status(400).json({ success: false, message: "Please enter the rank name." });
                }

                const compiledDescription = `Contact: ${whatsappNumber || rankPhone || phone}\nRoutes: ${routesServed || 'All'}`;

                const { error: rankError } = await supabase
                    .from("ranks")
                    .insert({
                        admin_id: user.id,
                        name: rankName,
                        address: rankAddress || rankName,
                        opening_time: openingTime || null,
                        closing_time: closingTime || null,
                        description: compiledDescription,
                        is_open: false,
                        rank_type: role === "BUS_RANK_ADMIN" ? "BUS" : "TAXI" // Clearly distinguishes rank terminal type
                    });

                if (rankError) {
                    await supabase.from("users").delete().eq("id", user.id);
                    return res.status(500).json({ success: false, message: "Failed to create rank.", error: rankError.message });
                }
            }

            return res.status(201).json({
                success: true,
                message: "Rank application submitted. Awaiting Super Admin approval."
            });
        }

    } catch (error) {
        console.error("Registration crash:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Registration failed due to server error.", 
            error: error.message,
            stack: error.stack 
        });
    }
});

module.exports = router;