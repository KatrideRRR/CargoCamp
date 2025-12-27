require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const authenticateToken = require('../middlewares/userAuth');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const axios = require("axios");
const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/upload-document');
    },
    filename: (req, file, cb) => {
        const userId = req.user.id;
        const ext = path.extname(file.originalname);

        User.findByPk(userId)
            .then(user => {
                const imageCount = user.documentPhotos ? user.documentPhotos.length : 0;
                const newFileName = `${userId}_${imageCount + 1}${ext}`;
                cb(null, newFileName);
            })
            .catch(error => {
                cb(error);
            });
    }
});

const upload = multer({ storage });

const generateTemporaryPassword = () => {
    return Math.random().toString(36).slice(-8);
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const smsCodes = new Map();

const CODE_TTL_MS = 5 * 60 * 1000; // 5 минут

router.post("/send-sms", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Введите номер телефона" });

    const code = generateCode();
    smsCodes.set(phone, { code, expiresAt: Date.now() + CODE_TTL_MS });

    try {
        console.log("Отправка SMS на:", phone);

        const response = await axios.get("https://sms.ru/sms/send", {
            params: {
                api_id: "706A8778-9606-1CA6-F061-72BA6F3A60E3",
                to: phone,
                msg: `Ваш код подтверждения: ${code}`,
                json: 1,
            },
        });

        console.log(response.data);

        if (response.data.status === "OK") {
            return res.json({ message: "Код отправлен" });
        } else {
            return res.status(500).json({ message: "Ошибка отправки SMS" });
        }
    } catch (error) {
        console.error("Ошибка SMS:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post('/upload-documents',authenticateToken, upload.array('documents', 5), async (req, res) => {
    try {
        const userId = req.user.id; // Получаем ID пользователя из токена или сессии

        const fileNames = req.files.map(file => file.filename); // Получаем имена загруженных файлов

        // Обновляем пользователя с новыми файлами
        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        // Добавляем новые изображения в массив
        const updatedPhotos = user.documentPhotos ? [...user.documentPhotos, ...fileNames] : fileNames;

        user.documentPhotos = updatedPhotos; // Обновляем поле с изображениями
        await user.save(); // Сохраняем изменения в базе данных

        res.status(200).json({ message: 'Документы загружены успешно', files: updatedPhotos });
    } catch (error) {
        console.error('Ошибка при загрузке документов:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.post('/register', async (req, res) => {
    const { username, phone, password, captchaToken, smsCode } = req.body;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 86400000); // 7 дней

    if (!captchaToken) {
        return res.status(400).json({ error: "Капча не пройдена" });
    }

    if (!smsCodes.has(phone) || smsCodes.get(phone) !== smsCode) {
        return res.status(400).json({ message: "Неверный код" });
    }

    try {
        // Проверка reCAPTCHA
        const response = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify`,
            null,
            {
                params: {
                    secret: SECRET_KEY,
                    response: captchaToken
                }
            }
        );

        if (!response.data.success) {
            return res.status(400).json({ error: "Ошибка капчи" });
        }

    } catch (error) {
        console.error("Ошибка запроса к Google reCAPTCHA:", error);
        return res.status(500).json({ error: "Ошибка проверки капчи" });
    }

    try {
        // Проверка на существующего пользователя
        const userExists = await User.findOne({ where: { phone } });
        if (userExists) return res.status(400).json({ message: "Телефон уже используется" });

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);

        // Создание нового пользователя
        const newUser = await User.create({ username, phone, password: hashedPassword,
            verified: true,subscription_type: 'premium',
            subscription_expires_at: expiresAt
        });

        smsCodes.delete(phone); // Удаляем код после успешной регистрации

        // Генерация токена
        const token = jwt.sign({ id: newUser.id, phone: newUser.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });

        return res.status(201).json({ message: "Пользователь зарегистрирован", token });

    } catch (error) {
        console.error("Ошибка регистрации:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const user = await User.findOne({ where: { phone } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }
        if (user.role === 'banned') {
            return res.status(403).json({ message: 'Ваш аккаунт заблокирован' });
        }


        const token = jwt.sign({ id: user.id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, phone: user.phone, rating: user.rating || 5 } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post("/login-sms", async (req, res) => {
    const { phone, smsCode } = req.body;

    try {
        if (!phone) return res.status(400).json({ message: "Введите номер телефона" });
        if (!smsCode) return res.status(400).json({ message: "Введите код из SMS" });

        const entry = smsCodes.get(phone);
        if (!entry) return res.status(401).json({ message: "Код не найден. Запросите новый." });

        if (Date.now() > entry.expiresAt) {
            smsCodes.delete(phone);
            return res.status(401).json({ message: "Код истёк. Запросите новый." });
        }

        if (entry.code !== smsCode) {
            return res.status(401).json({ message: "Неверный код" });
        }

        // одноразовость
        smsCodes.delete(phone);

        const user = await User.findOne({ where: { phone } });
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === "banned") {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
        }

        const token = jwt.sign(
            { id: user.id, phone: user.phone },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, phone: user.phone, rating: user.rating || 5 }
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
                'debt',
                'yookassa_payment_method_id',
                'cardLastFour', 'cardType',
                'rating', 'createdAt',
                'complaints', 'complaintsCount',
                'userStatus',
                'subscription_type', 'subscription_expires_at'
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

            debt: user.debt,

            subscriptionType: user.subscription_type,
            subscriptionExpiresAt: user.subscription_expires_at,
            isPremium: user.subscription_type === 'premium',

            yookassaPaymentMethodId: user.yookassa_payment_method_id,
            cardLastFour: user.cardLastFour,
            cardType: user.cardType,
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

        if (phone && phone !== user.phone) {
            const phoneExists = await User.findOne({ where: { phone } });
            if (phoneExists) {
                return res.status(400).json({ message: 'Phone already in use' });
            }
        }

        user.username = username || user.username;
        user.phone = phone || user.phone;
        await user.save();

        res.json({ message: 'Profile updated', user: { id: user.id, username: user.username, phone: user.phone } });
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
        const user = await User.findByPk(req.params.id, {
            attributes: ['id', 'username', 'rating', 'complaintsCount', 'complaints', 'phone']
        });
        if (!user) return res.status(404).json({ message: "Пользователь не найден" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/rate", authenticateToken,async (req, res) => {
    try {
        console.log('Получен запрос на рейтинг');

        const { userId, rating } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        user.rating = (user.rating * user.ratingCount + rating) / (user.ratingCount + 1);
        user.ratingCount += 1;

        await user.save();

        res.json({ message: "Рейтинг успешно обновлен" });
    } catch (error) {
        console.error("Ошибка обновления рейтинга", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/recover-password", async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ message: "Введите номер телефона" });
    }

    try {
        const user = await User.findOne({ where: { phone } });
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

router.post('/buy', authenticateToken, async (req, res) => {
    const userId = req.user.id; // получен из токена
    const { duration } = req.body; // '7d' или '30d'

    const daysMap = {
        '7d': 7,
        '30d': 30,
    };

    const days = daysMap[duration];
    if (!days) {
        return res.status(400).json({ error: 'Неверная длительность подписки' });
    }

    try {
        const executor = await User.findByPk(userId);
        if (!executor) return res.status(404).json({ error: 'Пользователь не найден' });

        const now = new Date();
        const newExpiration = executor.subscription_expires_at && executor.subscription_type === 'premium'
            ? new Date(executor.subscription_expires_at.getTime() + days * 86400000) // продлеваем текущую
            : new Date(now.getTime() + days * 86400000); // новая подписка

        executor.subscription_type = 'premium';
        executor.subscription_expires_at = newExpiration;
        await executor.save();

        return res.json({ success: true, until: newExpiration });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;
