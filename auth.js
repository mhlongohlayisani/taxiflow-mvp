// ============================================
// TAXIFLOW AUTHENTICATION
// ============================================

const users = require("./users");


// ============================================
// LOGIN
// ============================================

function login(username, password) {

    const user = users.find(

        u =>
            u.username.toLowerCase() ===
                String(username).toLowerCase()
            &&
            u.password === password

    );


    if (!user) {

        return {
            success: false,
            message: "Invalid username or password."
        };

    }


    if (user.status !== "APPROVED") {

        return {
            success: false,
            message: "This account has not been approved."
        };

    }


    return {

        success: true,

        user: {

            id: user.id,

            name: user.name,

            username: user.username,

            phone: user.phone,

            role: user.role,

            status: user.status,

            rankId: user.rankId

        }

    };

}


module.exports = {
    login
};