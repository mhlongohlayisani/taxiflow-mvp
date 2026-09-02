const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "taxiflow_super_secret_key_2026";

function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Contains { id, role, email, etc. }
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: "Invalid or expired token." });
    }
}

module.exports = { verifyToken, JWT_SECRET };