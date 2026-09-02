const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

router.get("/search/destination", async (req, res) => {
    try {
        const query = (req.query.q || "").toLowerCase().trim();
        if (!query) return res.json({ success: true, results: [] });

        const { data: ranks, error } = await supabase
            .from("ranks")
            .select("id, name, address, description, latitude, longitude");

        if (error) throw error;

        const matches = (ranks || []).filter(r => 
            (r.name && r.name.toLowerCase().includes(query)) ||
            (r.address && r.address.toLowerCase().includes(query)) ||
            (r.description && r.description.toLowerCase().includes(query))
        );

        const results = matches.map(m => ({
            place_name: m.name,
            address: m.address,
            latitude: m.latitude,
            longitude: m.longitude,
            nearest_route: m.address || m.name
        }));

        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Save Assistant Preferences, Bot Name, and Voice Gender
router.post("/preference", async (req, res) => {
    try {
        const { userId, mode, botName, voiceGender } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: "User ID required." });

        const updateData = {};
        if (mode) updateData.assistant_mode = mode;
        if (botName) updateData.bot_name = botName.trim();
        if (voiceGender) updateData.voice_gender = voiceGender;

        const { error } = await supabase
            .from("users")
            .update(updateData)
            .eq("id", userId);

        if (error) throw error;
        res.json({ success: true, message: "Preferences saved successfully." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Fetch Preferences
router.get("/preference/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from("users")
            .select("assistant_mode, bot_name, voice_gender")
            .eq("id", userId)
            .maybeSingle();

        if (error) throw error;
        res.json({ 
            success: true, 
            mode: data?.assistant_mode || 'text',
            botName: data?.bot_name || 'Sipho',
            voiceGender: data?.voice_gender || 'female'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// GET Route: Fetch the commuter's current points
router.get('/:id/points', async (req, res) => {
    const userId = req.params.id;

    try {
        const { data, error } = await supabase
            .from('users') 
            .select('points')
            .eq('id', userId)
            .single();

        if (error) throw error;

        res.json({ success: true, points: data.points || 0 });
    } catch (err) {
        console.error('Error fetching points:', err);
        res.status(500).json({ success: false, message: 'Server error fetching points' });
    }
});

// POST Route: Add points to the commuter's wallet
// POST Route: Verify Passcode & Add Points
router.post('/:id/add-points', async (req, res) => {
    const userId = req.params.id;
    const { pointsToAdd, driverId, passcode } = req.body;

    if (!passcode || !driverId) {
        return res.status(400).json({ success: false, message: 'Missing scan data or passcode.' });
    }

    try {
        // 1. Verify Driver's Passcode & Expiration (Querying 'users' instead of 'drivers')
        const { data: driverData, error: driverErr } = await supabase
            .from('users') 
            .select('daily_passcode, passcode_updated_at')
            .eq('id', driverId)
            .single();

        if (driverErr || !driverData || driverData.daily_passcode !== passcode) {
            return res.status(400).json({ success: false, message: 'Invalid passcode.' });
        }

        // Check if passcode is older than 24 hours
        // Check if passcode was created on a previous calendar day
const passcodeDate = new Date(driverData.passcode_updated_at).toDateString();
const todayDate = new Date().toDateString();

if (passcodeDate !== todayDate) {
    return res.status(400).json({ success: false, message: 'Passcode expired at midnight. Ask the driver for today\'s new code.' });
}

        // 2. Check if this commuter ALREADY used this specific passcode
        const { data: usedData } = await supabase
            .from('scanned_passcodes')
            .select('id')
            .eq('commuter_id', userId)
            .eq('passcode', passcode)
            .maybeSingle();

        if (usedData) {
            return res.status(400).json({ success: false, message: 'Passcode already used! You can only claim points for a ride once.' });
        }

        // 3. Record the usage to prevent future cheating
        await supabase
            .from('scanned_passcodes')
            .insert([{ commuter_id: userId, driver_id: driverId, passcode: passcode }]);

        // 4. Add the Points to the Commuter
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select('points')
            .eq('id', userId)
            .single();

        if (fetchError) throw fetchError;

        const newTotal = (userData.points || 0) + pointsToAdd;

        await supabase
            .from('users')
            .update({ points: newTotal })
            .eq('id', userId);

        res.json({ success: true, newTotal: newTotal });
    } catch (err) {
        console.error('Error verifying scan:', err);
        res.status(500).json({ success: false, message: 'Server error verifying scan.' });
    }
});

module.exports = router;