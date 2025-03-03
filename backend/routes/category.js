// routes/Category.js
const express = require('express');
const { Category, Subcategory } = require('../models');
const router = express.Router();

// Получение всех категорий
router.get('/', async (req, res) => {
    try {
        const categories = await Category.findAll({
            include: [{ model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] }]
        });
        res.json(categories);
    } catch (error) {
        console.error("Ошибка при получении категорий:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});


// Получение подкатегорий для выбранной категории
router.get('/subcategory/:categoryId', async (req, res) => {
    const { categoryId } = req.params;
    try {
        const subcategories = await Subcategory.findAll({
            where: { categoryId },
        });
        res.json(subcategories);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось загрузить подкатегории.' });
    }
});

module.exports = router;
