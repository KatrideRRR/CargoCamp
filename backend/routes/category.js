const express = require('express');
const { Category, Subcategory, Service } = require('../models');
const router = express.Router();

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

router.get('/subcategory/:categoryId', async (req, res) => {
    const { categoryId } = req.params;
    try {
        const subcategories = await Subcategory.findAll({
            where: { categoryId },
            attributes: ['id', 'name', 'price'], // 👈 важно включить price

        });
        res.json(subcategories);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось загрузить подкатегории.' });
    }
});

router.get('/services/:subcategoryId', async (req, res) => {
    const { subcategoryId } = req.params;
    try {
        const services = await Service.findAll({
            where: { subcategoryId },
            attributes: ['id', 'name', 'price'],
            order: [['name', 'ASC']]
        });
        res.json(services);
    } catch (error) {
        console.error("Ошибка при получении услуг:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

module.exports = router;
