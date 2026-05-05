// backend/config/firebaseAdmin.js

const path = require("path");
const admin = require("firebase-admin");

let initialized = false;

function initFirebaseAdmin() {
    if (initialized || admin.apps.length) {
        initialized = true;
        return admin;
    }

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!serviceAccountPath) {
        console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT_PATH не задан. Push отключён.");
        return null;
    }

    const fullPath = path.resolve(__dirname, "..", serviceAccountPath);
    const serviceAccount = require(fullPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });

    initialized = true;
    console.log("✅ Firebase Admin initialized");

    return admin;
}

module.exports = {
    initFirebaseAdmin,
};