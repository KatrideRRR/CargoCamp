const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envFile = fs.existsSync(path.resolve(__dirname, ".env.local"))
    ? ".env.local"
    : ".env";

dotenv.config({ path: path.resolve(__dirname, envFile) });
console.log(`✅ Загружен файл окружения: ${envFile}`);

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");

const makeActionLogger = require("./utils/actionLogger");
const { initializeSocket } = require("./socket");
const orderRoutes = require("./routes/orders");
const authRoutes = require("./routes/auth");
const messagesRoutes = require("./routes/messages");
const categoryRouter = require("./routes/category");
const adminRoutes = require("./routes/admin");
const payments = require("./routes/payments");
const disputeRoutes = require("./routes/disputes");
const expressOrdersRoutes = require("./routes/expressorders");
const logActionMiddleware = require("./middlewares/logActionMiddleware");
const allowedOrigins = require("./config/allowedOrigins");
const tbankPaymentsRoutes = require("./routes/tbankPayments");

const db = require("./models");
const sequelize = require("./config/database");

const uploadsDir = path.join(__dirname, "uploads");
const ordersUploadsDir = path.join(uploadsDir, "orders");

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(ordersUploadsDir)) {
    fs.mkdirSync(ordersUploadsDir, { recursive: true });
}

db.Sequelize = sequelize.constructor;
db.sequelize = sequelize;

const app = express();

app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    })
);

const server = http.createServer(app);
const io = initializeSocket(server);

app.locals.io = io;

const { logAction } = makeActionLogger({ db });
app.locals.logAction = logAction;
app.set("logAction", logAction);

app.use(logActionMiddleware);

app.use((req, res, next) => {
    req.logAction = typeof logAction === "function" ? logAction : async () => {};
    next();
});

db.sequelize.sync();

const corsOptions = {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/contracts", express.static(path.join(__dirname, "contracts")));

app.use("/api/orders", orderRoutes(io));
app.use("/api/disputes", disputeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/category", categoryRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", payments);
app.use("/api/express", expressOrdersRoutes);
app.use("/api/tbank-payments", tbankPaymentsRoutes);

app.post("/api/token", (req, res) => {
    const { token } = req.body;

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.REFRESH_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);

        const accessToken = jwt.sign(
            { id: user.id },
            process.env.ACCESS_SECRET,
            { expiresIn: "15m" }
        );

        res.json({ accessToken });
    });
});

sequelize.authenticate().catch((err) => {
    console.error("Database connection error:", err);
});

const PORT = process.env.PORT;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});