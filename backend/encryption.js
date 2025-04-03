const crypto = require("crypto");

const ENCRYPTION_KEY = crypto.createHash("sha256").update("super_secret_key").digest(); // Генерируем 32-байтный ключ
const IV_LENGTH = 16; // Длина вектора инициализации для AES

function encryptCard(cardNumber) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(cardNumber, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + encrypted; // Сохраняем IV вместе с зашифрованными данными
}

function decryptCard(encryptedData) {
    const iv = Buffer.from(encryptedData.substring(0, IV_LENGTH * 2), "hex");
    const encryptedText = encryptedData.substring(IV_LENGTH * 2);
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

module.exports = { encryptCard, decryptCard };
