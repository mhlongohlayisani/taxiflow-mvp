const jwt = require("jsonwebtoken");

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be set in .env and contain at least 32 characters.");
    }
    return secret;
}

function verifyToken(req, res, next) {
    const authHeader = req.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            code: "TOKEN_MISSING",
            message: "Access denied. Please sign in."
        });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        return res.status(401).json({
            success: false,
            code: "TOKEN_MISSING",
            message: "Access denied. Please sign in."
        });
    }

    try {
        req.user = jwt.verify(token, getJwtSecret(), {
            algorithms: ["HS256"],
            issuer: "taxiflow-api",
            audience: "taxiflow-web"
        });
        next();
    } catch (error) {
        const expired = error.name === "TokenExpiredError";
        return res.status(401).json({
            success: false,
            code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
            message: expired ? "Your session has expired. Please sign in again." : "Invalid authentication token."
        });
    }
}

function allowRoles(...roles) {
    const allowed = roles.map(role => String(role).toUpperCase());
    return (req, res, next) => {
        const role = String(req.user?.role || "").toUpperCase();
        if (!allowed.includes(role)) {
            return res.status(403).json({ success: false, message: "You do not have permission to use this feature." });
        }
        next();
    };
}

module.exports = { verifyToken, allowRoles, getJwtSecret };
