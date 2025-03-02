require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');

const { initializeSocket } = require('./socket'); // Импортируем инициализацию WebSocket
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const messagesRoutes = require('./routes/messages');
const categoryRouter = require('./routes/category');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
const server = http.createServer(app);

// Инициализация WebSocket
const io = initializeSocket(server);
const db = require('./models');
db.sequelize.sync();

app.use(cors({  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://18.193.72.111:3000'], methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(bodyParser.json());
app.use('/api/orders', orderRoutes(io));
app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api/category', categoryRouter);
app.use('/api/admin', adminRoutes);
app.use("/api/payments", paymentRoutes);

// Database connection
const Sequelize = require('sequelize');
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT,
    logging: false,
});

app.post('/api/token', (req, res) => {
    const { token } = req.body;

    if (!token) return res.sendStatus(401);

    // Проверяем refreshToken
    jwt.verify(token, process.env.REFRESH_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);

        // Создаём новый accessToken
        const accessToken = jwt.sign({ id: user.id }, process.env.ACCESS_SECRET, { expiresIn: '15m' });

        res.json({ accessToken });
    });
});

sequelize.authenticate()
    .then(() => console.log('Database connected.'))
    .catch((err) => console.error('Database connection error:', err));

sequelize.sync()
    .then(() => console.log('Database synchronized.'))
    .catch(err => console.error('Error synchronizing database:', err));

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
