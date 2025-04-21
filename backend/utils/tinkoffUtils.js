const crypto = require("crypto");
const PASSWORD = process.env.TINKOFF_PASSWORD;

function generateToken(params) {
    delete params.Token;
    const { Receipt, ...paramsWithoutReceipt } = params;

    paramsWithoutReceipt.Password = PASSWORD;
    const sortedKeys = Object.keys(paramsWithoutReceipt).sort();

    const dataString = sortedKeys.map((key) => paramsWithoutReceipt[key]).join("");
    const hash = crypto.createHash("sha256").update(dataString).digest("hex");

    delete paramsWithoutReceipt.Password;
    return hash;
}

module.exports = { generateToken };
