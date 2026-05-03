const allowedOrigins = [
    // Local dev
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8080",
    "http://localhost:8100",

    // Capacitor mobile apps
    "capacitor://localhost",
    "ionic://localhost",

    // Old / direct IP access
    "http://18.184.43.44:3001",
    "http://81.163.27.147:8080",
    "https://81.163.27.147:3001",
    "https://81.163.27.147:8080",

    // Production domains
    "https://cargocamp.ru",
    "https://www.cargocamp.ru",
    "https://admin.cargocamp.ru",
    "https://api.cargocamp.ru",
];

module.exports = allowedOrigins;