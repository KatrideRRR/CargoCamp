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

const {
    uploadsRoot,
    contractsRoot,
} = require("./config/storagePaths");

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
const pushTokensRoutes = require("./routes/pushTokens");
const supportRoutes = require("./routes/support");
const adminSupportRoutes = require("./routes/adminSupport");
const {notifySystemError} = require("./services/adminNotificationService");

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

db.sequelize.sync().catch((err) => {
    console.error(
        "Database sync error:",
        err
    );

    void notifySystemError({
        title: "🚨 Ошибка синхронизации базы данных",
        error: err,
        extra: "db.sequelize.sync()",
    });
});

const corsOptions = {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};

app.set("etag", false);

app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
});

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(bodyParser.json());
app.use(
    "/uploads",
    express.static(uploadsRoot)
);

app.use("/contracts", express.static(contractsRoot, {
        fallthrough: false,
        setHeaders: (res, filePath) => {
            if (
                path.extname(filePath)
                    .toLowerCase() === ".pdf"
            ) {
                res.setHeader(
                    "Content-Type",
                    "application/pdf"
                );

                res.setHeader(
                    "Content-Disposition",
                    "inline"
                );
            }
        },
    }));

console.log(
    "Uploads directory:",
    uploadsRoot
);

console.log(
    "Contracts directory:",
    contractsRoot
);

app.use("/api/orders", orderRoutes(io));
app.use("/api/disputes", disputeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/category", categoryRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", payments);
app.use("/api/express", expressOrdersRoutes);
app.use("/api/tbank-payments", tbankPaymentsRoutes);
app.use("/api/push", pushTokensRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin/support", adminSupportRoutes);

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

app.use((error, req, res, next) => {
    console.error("Unhandled Express error:", error);

    notifySystemError({
        title: "🚨 Необработанная ошибка API",
        error,
        req,
    });

    if (res.headersSent) {
        return next(error);
    }

    return res.status(
        Number(error?.status) || 500
    ).json({
        success: false,
        message:
            process.env.NODE_ENV === "production"
                ? "Внутренняя ошибка сервера"
                : error?.message ||
                "Внутренняя ошибка сервера",
    });
});

process.on(
    "unhandledRejection",
    (reason) => {
        console.error(
            "Unhandled Promise Rejection:",
            reason
        );

        void notifySystemError({
            title: "🚨 Unhandled Promise Rejection",

            error:
                reason instanceof Error
                    ? reason
                    : new Error(String(reason)),
        });
    }
);

process.on(
    "uncaughtException",
    async (error) => {
        console.error(
            "Uncaught Exception:",
            error
        );

        try {
            await notifySystemError({
                title: "💥 Uncaught Exception",
                error,
            });
        } catch (notifyError) {
            console.error(
                "Не удалось отправить системное уведомление:",
                notifyError
            );
        }

        process.exit(1);
    }
);

sequelize.authenticate().catch((err) => {
    console.error("Database connection error:", err);

    notifySystemError({
        title: "🚨 Ошибка подключения к базе данных",
        error: err,
        extra: "sequelize.authenticate()",
    });
});

const PORT = process.env.PORT;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});