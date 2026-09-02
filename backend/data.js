const ranks = [
    {
        id: 1,
        name: "Tzaneen Taxi Rank",
        location: "Tzaneen",
        status: "OPEN",
        openingTime: "05:00",
        closingTime: "22:00",
        taxiMovement: "FAST",
        taxisAvailable: 18,
        availableSeats: 12,

        routes: [
            "Tzaneen → Polokwane",
            "Tzaneen → Giyani",
            "Tzaneen → Nkowankowa"
        ],

        admin: {
            name: "Tzaneen Rank Admin",
            phone: ""
        }
    },

    {
        id: 2,
        name: "Polokwane Rank",
        location: "Polokwane",
        status: "OPEN",
        openingTime: "04:30",
        closingTime: "22:30",
        taxiMovement: "NORMAL",
        taxisAvailable: 31,
        availableSeats: 24,

        routes: [
            "Polokwane → Tzaneen",
            "Polokwane → Pretoria",
            "Polokwane → Johannesburg"
        ],

        admin: {
            name: "Polokwane Rank Admin",
            phone: ""
        }
    },

    {
        id: 3,
        name: "Local Route Rank",
        location: "Nearby",
        status: "CLOSED",
        openingTime: "05:30",
        closingTime: "20:00",
        taxiMovement: "SLOW",
        taxisAvailable: 0,
        availableSeats: 0,

        routes: [
            "Local Route"
        ],

        admin: {
            name: "Local Rank Admin",
            phone: ""
        }
    }
];

module.exports = ranks;