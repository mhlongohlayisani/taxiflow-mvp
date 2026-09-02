// 1. Get all ranks except the current user's rank (to choose who to chat with)
router.get('/ranks/other/:currentRankId', async (req, res) => {
    const currentRankId = req.params.currentRankId;
    try {
        const { data, error } = await supabase
            .from('ranks')
            .select('id, name, address')
            .neq('id', currentRankId);

        if (error) throw error;
        res.json({ success: true, ranks: data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch other ranks.' });
    }
});

// 2. Get messages between two specific ranks
router.get('/chat/:rankA/:rankB', async (req, res) => {
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
        res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
    }
});

// 3. Send a message to another rank
router.post('/chat/send', async (req, res) => {
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
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
});