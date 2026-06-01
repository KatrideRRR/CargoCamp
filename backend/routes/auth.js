require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, OrderReview, Order, Category, ExpressOrder } = require('../models');
const authenticateToken = require('../middlewares/userAuth');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const axios = require("axios");
const fs = require('fs');
const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

const avatarsDir = path.join(__dirname, "..", "uploads", "avatars");
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const uploadDocumentsRoot = path.join(uploadsRoot, 'upload-document');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

ensureDir(uploadsRoot);
ensureDir(uploadDocumentsRoot);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            ensureDir(uploadDocumentsRoot);
            cb(null, uploadDocumentsRoot);
        } catch (error) {
            cb(error);
        }
    },

    filename: async (req, file, cb) => {
        try {
            const userId = req.user.id;
            const ext = path.extname(file.originalname) || '.jpg';

            const user = await User.findByPk(userId);
            const imageCount = Array.isArray(user?.documentPhotos) ? user.documentPhotos.length : 0;
            const newFileName = `${userId}_${imageCount + 1}${ext}`;

            cb(null, newFileName);
        } catch (error) {
            cb(error);
        }
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    }
});

if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({

    destination: (req, file, cb) => {

        cb(null, avatarsDir);

    },

    filename: async (req, file, cb) => {

        try {

            const userId = req.user.id;

            const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";

            // удалим старые варианты этого же файла, чтобы не копились .png/.jpg/.webp

            const possibleExts = [".jpg", ".jpeg", ".png", ".webp"];

            for (const e of possibleExts) {

                const oldPath = path.join(avatarsDir, `${userId}${e}`);

                if (fs.existsSync(oldPath)) {

                    fs.unlinkSync(oldPath);

                }

            }

            cb(null, `${userId}${ext}`);

        } catch (err) {

            cb(err);

        }

    },

});

const uploadAvatar = multer({

    storage: avatarStorage,

    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB

    fileFilter: (req, file, cb) => {

        if (file.mimetype.startsWith("image/")) {

            cb(null, true);

        } else {

            cb(new Error("Разрешены только изображения"));

        }

    },

});

const generateTemporaryPassword = () => {
    return Math.random().toString(36).slice(-8);
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const smsCodes = new Map();

const CODE_TTL_MS = 5 * 60 * 1000; // код живёт 5 минут
const SMS_RESEND_COOLDOWN_MS = 60 * 1000; // повторная отправка не чаще 60 сек
const SMS_MAX_SENDS = 5; // максимум 5 SMS
const SMS_WINDOW_MS = 15 * 60 * 1000; // за 15 минут

function normalizePhone(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
    if (digits.length === 11 && digits.startsWith("7")) return digits;
    if (digits.length === 10) return "7" + digits;
    return digits;
}

router.post("/upload-avatar", authenticateToken, uploadAvatar.single("avatar"), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: "Файл не загружен" });
            }

            const user = await User.findByPk(req.user.id);
            if (!user) {
                return res.status(404).json({ message: "Пользователь не найден" });
            }

            const avatarPath = `/uploads/avatars/${req.file.filename}`;

            user.avatar = avatarPath;
            await user.save();

            return res.json({
                success: true,
                message: "Фото профиля загружено",
                avatar: avatarPath,
            });
        } catch (error) {
            console.error("Ошибка загрузки аватара:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

router.post("/send-sms", async (req, res) => {
    const { phone, captchaToken, purpose = "register" } = req.body;

    if (!phone) {
        return res.status(400).json({ message: "Введите номер телефона" });
    }

    const phoneKey = normalizePhone(phone);

    if (!phoneKey || phoneKey.length !== 11 || !phoneKey.startsWith("7")) {
        return res.status(400).json({ message: "Некорректный номер телефона" });
    }

    const existingUser = await User.findOne({ where: { phone: phoneKey } });

    if (purpose === "register" && existingUser) {
        return res.status(400).json({ message: "Телефон уже используется" });
    }

    if ((purpose === "login" || purpose === "password_reset") && !existingUser) {
        return res.status(404).json({ message: "Пользователь не найден" });
    }

    if (purpose === "register") {
        if (!captchaToken) {
            return res.status(400).json({ message: "Капча не пройдена" });
        }

        try {
            const captchaResponse = await axios.post(
                "https://www.google.com/recaptcha/api/siteverify",
                null,
                {
                    params: {
                        secret: SECRET_KEY,
                        response: captchaToken,
                    },
                    timeout: 10000,
                }
            );

            if (!captchaResponse.data?.success) {
                return res.status(400).json({ message: "Ошибка капчи" });
            }
        } catch (error) {
            console.error("Ошибка проверки reCAPTCHA при отправке SMS:", error?.message);
            return res.status(500).json({ message: "Ошибка проверки капчи" });
        }
    }

    const now = Date.now();
    const existing = smsCodes.get(phoneKey);

    if (existing?.lastSentAt && now - existing.lastSentAt < SMS_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((SMS_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);

        return res.status(429).json({
            message: `Отправить код повторно можно через ${waitSec} сек.`,
            waitSec,
        });
    }

    let sendHistory = Array.isArray(existing?.sendHistory) ? existing.sendHistory : [];

    sendHistory = sendHistory.filter((time) => now - time < SMS_WINDOW_MS);

    if (sendHistory.length >= SMS_MAX_SENDS) {
        return res.status(429).json({
            message: "Слишком много попыток отправки SMS. Попробуйте позже.",
        });
    }

    const apiId = process.env.SMS_RU_API_ID;

    if (!apiId) {
        return res.status(500).json({ message: "SMS_RU_API_ID не задан" });
    }

    const code = generateCode();

    try {
        const response = await axios.get("https://sms.ru/sms/send", {
            params: {
                api_id: apiId,
                to: phoneKey,
                msg: `Ваш код подтверждения: ${code}`,
                json: 1,
            },
            timeout: 15000,
        });

        if (response.data?.status === "OK") {
            smsCodes.set(phoneKey, {
                code,
                expiresAt: now + CODE_TTL_MS,
                lastSentAt: now,
                sendHistory: [...sendHistory, now],
                attempts: 0,
            });

            return res.json({
                message: "Код отправлен",
                cooldownSec: Math.ceil(SMS_RESEND_COOLDOWN_MS / 1000),
                expiresInSec: Math.ceil(CODE_TTL_MS / 1000),
            });
        }

        console.error("[SEND SMS] sms.ru отказал:", response.data);

        return res.status(500).json({
            message: "Не удалось отправить SMS. Попробуйте позже.",
        });
    } catch (error) {
        console.error("[SEND SMS] axios error message:", error?.message);
        console.error("[SEND SMS] status:", error?.response?.status);
        console.error("[SEND SMS] data:", error?.response?.data);

        return res.status(500).json({
            message: "Ошибка отправки SMS",
        });
    }
});

router.post("/password-reset/confirm", async (req, res) => {
    const { phone, smsCode, newPassword } = req.body;

    const phoneKey = normalizePhone(phone);
    const codeFromUser = String(smsCode || "").trim();

    if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ message: "Пароль должен быть минимум 6 символов" });
    }

    const entry = smsCodes.get(phoneKey);
    if (!entry) return res.status(400).json({ message: "Код не найден. Запросите новый." });

    if (Date.now() > entry.expiresAt) {
        smsCodes.delete(phoneKey);
        return res.status(400).json({ message: "Код истёк. Запросите новый." });
    }

    if (String(entry.code).trim() !== codeFromUser) {
        return res.status(400).json({ message: "Неверный код" });
    }

    const user = await User.findOne({ where: { phone: phoneKey } });
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    const hashed = await bcrypt.hash(String(newPassword), 10);
    await user.update({ password: hashed });

    smsCodes.delete(phoneKey);

    return res.json({ message: "Пароль успешно изменён" });
});

router.post('/upload-documents', authenticateToken, upload.array('documents', 5), async (req, res) => {
    try {
        const userId = req.user.id;

        const fileNames = (req.files || []).map(file => file.filename);

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const existingPhotos = Array.isArray(user.documentPhotos) ? user.documentPhotos : [];
        const updatedPhotos = [...existingPhotos, ...fileNames];

        user.documentPhotos = updatedPhotos;
        await user.save();

        res.status(200).json({
            message: 'Документы загружены успешно',
            files: updatedPhotos
        });
    } catch (error) {
        console.error('Ошибка при загрузке документов:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.post('/register', async (req, res) => {
    const { username, phone, password, smsCode } = req.body;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 дней

    const phoneKey = normalizePhone(phone);
    const codeFromUser = String(smsCode || "").trim();

    const entry = smsCodes.get(phoneKey); // {code, expiresAt} | undefined
    const codeSaved = String(entry?.code || "").trim();

    // ✅ проверка что код есть
    if (!entry) return res.status(400).json({ message: "Неверный код" });

    // ✅ TTL
    if (Date.now() > entry.expiresAt) {
        smsCodes.delete(phoneKey);
        return res.status(400).json({ message: "Код истёк. Запросите новый." });
    }

    // ✅ сравнение
    if (codeSaved !== codeFromUser) {
        entry.attempts = Number(entry.attempts || 0) + 1;

        if (entry.attempts >= 5) {
            smsCodes.delete(phoneKey);
            return res.status(400).json({
                message: "Слишком много неверных попыток. Запросите новый код.",
            });
        }

        smsCodes.set(phoneKey, entry);

        return res.status(400).json({ message: "Неверный код" });
    }

    try {
        // Проверка на существующего пользователя
        const userExists = await User.findOne({ where: { phone: phoneKey } });

        if (userExists) {
            return res.status(400).json({ message: "Телефон уже используется" });
        }

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);

        // Создание нового пользователя
        const newUser = await User.create({
            username,
            phone: phoneKey,
            password: hashedPassword,
            verified: true,
            subscription_type: "premium",
            subscription_expires_at: expiresAt,
        });

        smsCodes.delete(phoneKey);

        // Генерация токена
        const token = jwt.sign({ id: newUser.id, phone: newUser.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });

        return res.status(201).json({ message: "Пользователь зарегистрирован", token });

    } catch (error) {
        console.error("Ошибка регистрации:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/login", async (req, res) => {
    const { phone, password } = req.body;
    try {
        const phoneKey = normalizePhone(phone);

        const user = await User.findOne({ where: { phone: phoneKey } });
        if (!user) return res.status(404).json({ message: "User not found" });

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(401).json({ message: "Invalid password" });

        if (user.role === "banned") return res.status(403).json({ message: "Ваш аккаунт заблокирован" });

        const token = jwt.sign({ id: user.id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({ token, user: { id: user.id, username: user.username, phone: user.phone, rating: user.rating || 5 } });
    } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/login-sms", async (req, res) => {
    const { phone, smsCode } = req.body;

    try {
        if (!phone) return res.status(400).json({ message: "Введите номер телефона" });
        if (!smsCode) return res.status(400).json({ message: "Введите код из SMS" });

        const phoneKey = normalizePhone(phone);
        const codeFromUser = String(smsCode || "").trim();

        const entry = smsCodes.get(phoneKey);
        if (!entry) return res.status(401).json({ message: "Код не найден. Запросите новый." });

        if (Date.now() > entry.expiresAt) {
            smsCodes.delete(phoneKey);
            return res.status(401).json({ message: "Код истёк. Запросите новый." });
        }

        if (String(entry.code).trim() !== codeFromUser) {
            return res.status(401).json({ message: "Неверный код" });
        }

        smsCodes.delete(phoneKey);

        // ⚠️ ВАЖНО: искать пользователя тоже по нормализованному телефону
        const user = await User.findOne({ where: { phone: phoneKey } });
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === "banned") {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
        }

        const token = jwt.sign({ id: user.id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({
            token,
            user: { id: user.id, username: user.username, phone: user.phone, rating: user.rating || 5 },
        });
    } catch (error) {
        console.error("Login SMS error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: [
                'id', 'username', 'phone',
                'debt', 'avatar',
                'yookassa_payment_method_id',
                'cardLastFour', 'cardType',
                'rating', 'createdAt',
                'userStatus', 'documentPhotos',
                'subscription_type', 'subscription_expires_at',
                'preferredCategoryIds',
                'locationAddress', 'locationLat', 'locationLng', 'locationSource', 'locationUpdatedAt'
            ],
        });

        if (!user) return res.status(404).json({ message: 'User not found' });

        // если премиум истёк — сбрасываем
        if (
            user.subscription_type === 'premium' &&
            user.subscription_expires_at &&
            new Date(user.subscription_expires_at) < new Date()
        ) {
            user.subscription_type = 'standard';
            user.subscription_expires_at = null;
            await user.save();
        }

        return res.json({
            id: user.id,
            username: user.username,
            phone: user.phone,
            rating: user.rating,
            createdAt: user.createdAt,
            complaints: user.complaints,
            complaintsCount: user.complaintsCount,
            userStatus: user.userStatus,

            avatar: user.avatar,
            debt: user.debt,

            subscriptionType: user.subscription_type,
            subscriptionExpiresAt: user.subscription_expires_at,
            isPremium: user.subscription_type === 'premium',

            yookassaPaymentMethodId: user.yookassa_payment_method_id,
            cardLastFour: user.cardLastFour,
            cardType: user.cardType,
            preferredCategoryIds:user.preferredCategoryIds,

            locationAddress: user.locationAddress,
            locationLat: user.locationLat,
            locationLng: user.locationLng,
            locationSource: user.locationSource,
            locationUpdatedAt: user.locationUpdatedAt,
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/profile', authenticateToken, async (req, res) => {
    const { username, phone } = req.body;

    try {
        const user = await User.findByPk(req.user.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let phoneKey = null;

        if (phone) {
            phoneKey = normalizePhone(phone);

            if (!phoneKey || phoneKey.length !== 11 || !phoneKey.startsWith("7")) {
                return res.status(400).json({ message: "Некорректный номер телефона" });
            }

            if (phoneKey !== user.phone) {
                const phoneExists = await User.findOne({ where: { phone: phoneKey } });

                if (phoneExists) {
                    return res.status(400).json({ message: 'Phone already in use' });
                }
            }
        }

        user.username = username || user.username;
        user.phone = phoneKey || user.phone;

        await user.save();

        res.json({
            message: 'Profile updated',
            user: {
                id: user.id,
                username: user.username,
                phone: user.phone,
            },
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const user = await User.findByPk(userId); // Sequelize пример
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }
});

router.get('/user/:id', async (req, res) => {
    try {
        const userId = Number(req.params.id);

        const user = await User.findByPk(userId, {
            attributes: ['id', 'username', 'phone', 'rating', 'ratingCount', 'role', 'userStatus'],
        });
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        const reviewsCount = await OrderReview.count({ where: { toUserId: userId } });

        return res.json({ ...user.toJSON(), reviewsCount });
    } catch (err) {
        console.error('GET /auth/user/:id error:', err);
        return res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.post("/recover-password", async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ message: "Введите номер телефона" });
    }

    try {
        const phoneKey = normalizePhone(phone);
        const user = await User.findOne({ where: { phone: phoneKey } });
        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        // Генерируем временный пароль
        const tempPassword = generateTemporaryPassword();
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Обновляем пароль в базе данных
        await user.update({ password: hashedPassword });

        // Отправляем новый пароль через SMS
        const response = await axios.get("https://sms.ru/sms/send", {
            params: {
                api_id: "706A8778-9606-1CA6-F061-72BA6F3A60E3",
                to: phone,
                msg: `Ваш новый пароль: ${tempPassword}`, // Отправляем временный пароль
                json: 1,
            },
        });

        if (response.data.status === "OK") {
            return res.json({ message: "Новый пароль отправлен на ваш номер" });
        } else {
            return res.status(500).json({ message: "Ошибка отправки SMS" });
        }
    } catch (error) {
        console.error("Ошибка восстановления пароля:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/reviews/user/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const reviews = await OrderReview.findAll({
            where: { toUserId: userId },
            order: [["createdAt", "DESC"]],
        });

        return res.json({ reviews });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/review", authenticateToken, async (req, res) => {
    try {
        const fromUserId = req.user.id;
        const {
            orderId,
            rating,
            text,
            isExpress,
            toUserId: requestedToUserId,
            isCancellationReview,
        } = req.body;

        if (!orderId) {
            return res.status(400).json({ message: "orderId обязателен" });
        }

        const r = Number(rating);
        if (!Number.isFinite(r) || r < 1 || r > 5) {
            return res.status(400).json({ message: "rating должен быть от 1 до 5" });
        }

        let targetOrder = null;
        let orderType = "regular";

        // 1) если фронт явно передал, что заказ экспресс
        if (isExpress === true) {
            targetOrder = await ExpressOrder.findByPk(orderId);
            orderType = "express";
        } else {
            // 2) сначала пробуем обычный заказ
            targetOrder = await Order.findByPk(orderId);

            // 3) если обычный не найден — пробуем экспресс
            if (!targetOrder) {
                targetOrder = await ExpressOrder.findByPk(orderId);
                if (targetOrder) {
                    orderType = "express";
                }
            }
        }

        if (!targetOrder) {
            return res.status(404).json({ message: "Заказ не найден" });
        }

        const isCancelledExpressReview =
            orderType === "express" &&
            targetOrder.status === "cancelled" &&
            isCancellationReview === true;

        if (targetOrder.status !== "completed" && !isCancelledExpressReview) {
            return res.status(400).json({
                message: "Отзыв можно оставить только после завершения или отмены экспресс-заказа",
            });
        }

        const isCreator = Number(targetOrder.creatorId) === Number(fromUserId);
        const isExecutor = Number(targetOrder.executorId) === Number(fromUserId);

        if (!isCreator && !isExecutor) {
            return res.status(403).json({ message: "Вы не участник этого заказа" });
        }

        let toUserId = isCreator ? targetOrder.executorId : targetOrder.creatorId;

        if (isCancelledExpressReview && requestedToUserId) {
            const requestedId = Number(requestedToUserId);

            const isValidTarget =
                requestedId === Number(targetOrder.creatorId) ||
                requestedId === Number(targetOrder.executorId);

            if (!isValidTarget) {
                return res.status(400).json({
                    message: "Нельзя оценить пользователя, который не участвовал в заказе",
                });
            }

            if (requestedId === Number(fromUserId)) {
                return res.status(400).json({
                    message: "Нельзя оставить отзыв самому себе",
                });
            }

            toUserId = requestedId;
        }

        if (!toUserId) {
            return res.status(400).json({ message: "Невозможно определить второго участника" });
        }

        const existing = await OrderReview.findOne({
            where: { orderId, orderType, fromUserId }
        });

        if (existing) {
            return res.status(400).json({ message: "Вы уже оставляли отзыв по этому заказу" });
        }

        await OrderReview.create({
            orderId,
            fromUserId,
            toUserId,
            rating: r,
            text: (text || "").trim() || null,
            orderType,
        });

        const user = await User.findByPk(toUserId);
        if (!user) {
            return res.status(404).json({ message: "Пользователь для оценки не найден" });
        }

        const currentRating = Number(user.rating || 0);
        const currentCount = Number(user.ratingCount || 0);
        const newRating = (currentRating * currentCount + r) / (currentCount + 1);

        user.rating = newRating;
        user.ratingCount = currentCount + 1;
        await user.save();

        return res.json({
            message: "Отзыв сохранён",
            orderType,
            toUserId,
            rating: user.rating,
            ratingCount: user.ratingCount,
        });
    } catch (e) {
        if (
            e?.name === "SequelizeUniqueConstraintError" ||
            e?.original?.code === "ER_DUP_ENTRY"
        ) {
            return res.status(400).json({
                message: "Вы уже оставляли отзыв по этому заказу",
            });
        }

        console.error("review error:", e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/reviews/my", authenticateToken, async (req, res) => {
    try {
        const fromUserId = req.user.id;

        const reviews = await OrderReview.findAll({
            where: { fromUserId },
            attributes: ["id", "orderId", "toUserId", "rating", "createdAt"],
            order: [["createdAt", "DESC"]],
        });

        return res.json({ reviews });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/location/me", authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ["id", "locationAddress", "locationLat", "locationLng", "locationSource", "locationUpdatedAt"],
        });
        if (!user) return res.status(404).json({ message: "Пользователь не найден" });
        return res.json({ location: user });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/location/me", authenticateToken, async (req, res) => {
    try {
        const { address, lat, lng, source } = req.body;

        const allowed = ["gps", "manual", "map"];
        if (source && !allowed.includes(source)) {
            return res.status(400).json({ message: "Некорректный source" });
        }

        // address можно без координат (чисто ручной ввод)
        const latNum = lat === null || lat === undefined ? null : Number(lat);
        const lngNum = lng === null || lng === undefined ? null : Number(lng);

        if ((latNum !== null && !Number.isFinite(latNum)) || (lngNum !== null && !Number.isFinite(lngNum))) {
            return res.status(400).json({ message: "lat/lng должны быть числами" });
        }

        await User.update(
            {
                locationAddress: address?.trim() || null,
                locationLat: latNum,
                locationLng: lngNum,
                locationSource: source || null,
                locationUpdatedAt: new Date(),
            },
            { where: { id: req.user.id } }
        );

        const updated = await User.findByPk(req.user.id, {
            attributes: ["id", "locationAddress", "locationLat", "locationLng", "locationSource", "locationUpdatedAt"],
        });

        return res.json({ success: true, location: updated });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/categories/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { categoryIds } = req.body; // ожидаем массив чисел

        if (!Array.isArray(categoryIds)) {
            return res.status(400).json({ message: "categoryIds должен быть массивом" });
        }

        // чистим и валидируем
        const cleaned = [...new Set(categoryIds)]
            .map((x) => Number(x))
            .filter((x) => Number.isFinite(x));

        // проверим что такие категории существуют (важно!)
        const cats = await Category.findAll({ where: { id: cleaned } });
        if (cats.length !== cleaned.length) {
            return res.status(400).json({ message: "Некоторые категории не найдены" });
        }

        await User.update(
            { preferredCategoryIds: cleaned },
            { where: { id: userId } }
        );

        const updated = await User.findByPk(userId);
        return res.json({ success: true, preferredCategoryIds: updated.preferredCategoryIds });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

module.exports = router;
