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

const {uploadsRoot, contractsRoot,} = require("./config/storagePaths");
const publicUploadsPath = fs.realpathSync(uploadsRoot);
const privateContractsPath = fs.realpathSync(contractsRoot);
const relativeContractsPath = path.relative(publicUploadsPath, privateContractsPath);

const contractsInsideUploads =
    relativeContractsPath === "" ||
    (
        relativeContractsPath !== ".." &&
        !relativeContractsPath.startsWith(
            `..${path.sep}`
        ) &&
        !path.isAbsolute(relativeContractsPath)
    );

if (contractsInsideUploads) {
    throw new Error(
        "SECURITY: CONTRACTS_DIR не должен находиться внутри UPLOADS_DIR"
    );
}

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
const benefitsRoutes = require("./routes/benefits");
const adminSupportRoutes = require("./routes/adminSupport");
const {notifySystemError} = require("./services/adminNotificationService");
const adminBenefitsRoutes = require("./routes/adminBenefits");
const identityRoutes = require("./routes/identity");
const adminIdentityRoutes = require("./routes/adminIdentity");
const verifiedContractsRoutes = require("./routes/verifiedContracts");

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
app.use("/uploads/upload-document", async (req, res, next) => {
        try {
            if (
                req.method !== "GET" &&
                req.method !== "HEAD"
            ) {
                return res.sendStatus(405);
            }

            const fileName = String(
                req.path || ""
            ).replace(/^\/+/, "");

            // Только один обычный файл.
            // Поддиректории и произвольные имена запрещены.
            if (
                fileName.includes("/") ||
                !/^\d+_\d+\.(jpg|jpeg|png|webp)$/i.test(
                    fileName
                )
            ) {
                return res.sendStatus(404);
            }

            const publicPath =
                `/uploads/upload-document/${fileName}`;

            const vehicleOwner =
                await db.User.findOne({
                    where: {
                        vehiclePhoto: publicPath,
                    },

                    attributes: [
                        "id",
                        "documentPhotos",
                    ],
                });

            // Не является действующим фото автомобиля.
            if (!vehicleOwner) {
                return res.sendStatus(404);
            }

            const legacyDocuments =
                Array.isArray(
                    vehicleOwner.documentPhotos
                )
                    ? vehicleOwner.documentPhotos
                    : [];

            /*
             * Если файл одновременно указан
             * как старый паспортный документ,
             * запрещаем его выдачу.
             *
             * Это возможно из-за совпадений
             * имён в прежнем механизме загрузки.
             */
            const isIdentityDocument =
                legacyDocuments.some((entry) => {
                    const savedName = String(
                        entry || ""
                    );

                    return (
                        savedName === fileName ||
                        savedName === publicPath ||
                        savedName.endsWith(
                            `/${fileName}`
                        )
                    );
                });

            if (isIdentityDocument) {
                return res.sendStatus(404);
            }

            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );

            return next();

        } catch (error) {
            console.error(
                "Ошибка проверки публичного файла:",
                error
            );

            return res.sendStatus(500);
        }
    });
app.use("/uploads", express.static(uploadsRoot, {
        dotfiles: "deny",

        setHeaders: (res) => {
            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );
        },
    }));
app.use("/contracts", (req, res) => {
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    return res.sendStatus(404);
});

console.log(
    "Uploads directory:",
    uploadsRoot
);

console.log(
    "Contracts directory:",
    contractsRoot
);

app.use("/api/contracts", verifiedContractsRoutes);
app.use("/api/orders", orderRoutes(io));
app.use("/api/disputes", disputeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/category", categoryRouter);
app.use("/api/identity", identityRoutes);
app.use("/api/admin/identity", adminIdentityRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", payments);
app.use("/api/express", expressOrdersRoutes);
app.use("/api/tbank-payments", tbankPaymentsRoutes);
app.use("/api/push", pushTokensRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin/support", adminSupportRoutes);
app.use("/api/benefits", benefitsRoutes);
app.use("/api/admin/benefits", adminBenefitsRoutes);

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