const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const supabase = require("../config/supabase");

// ======================================================
// CREATE FIRST TAXIFLOW CREATOR (SUPER ADMIN)
// ======================================================

router.post("/create-creator", async (req, res) => {
    try {
        const {
            full_name,
            email,
            phone,
            password
        } = req.body;

        if (!full_name || !email || !password || !phone) {
            return res.status(400).json({
                success: false,
                message: "Full name, email, phone, and password are required"
            });
        }

        // Check whether a creator already exists
        const { data: existingCreator, error: checkError } = await supabase
            .from("users")
            .select("id")
            .eq("role", "SUPER_ADMIN")
            .limit(1);

        if (checkError) {
            return res.status(500).json({
                success: false,
                message: checkError.message
            });
        }

        if (existingCreator && existingCreator.length > 0) {
            return res.status(403).json({
                success: false,
                message: "TaxiFlow creator account already exists"
            });
        }

        // Hash the password
        const password_hash = await bcrypt.hash(password, 12);
        const username = email.split("@")[0].toLowerCase();

        // Insert into the new clean 'users' table
        const { data, error } = await supabase
            .from("users")
            .insert({
                full_name: full_name,
                username: username,
                email: email,
                phone: phone,
                password_hash: password_hash,
                role: "SUPER_ADMIN",
                account_status: "ACTIVE"
            })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        res.status(201).json({
            success: true,
            message: "TaxiFlow creator account created successfully.",
            creator: data
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to create creator account",
            error: error.message
        });
    }
});

module.exports = router;