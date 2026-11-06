function makeAdminToken(adminId = 1) {
    const encode = (value) =>
        Buffer.from(JSON.stringify(value))
            .toString("base64url");

    const header = {
        alg: "none",
        typ: "JWT",
    };

    const payload = {
        id: adminId,
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 7200,
    };

    return [
        encode(header),
        encode(payload),
        "",
    ].join(".");
}

const ADMIN_TEST_TOKEN = makeAdminToken();

async function setAdminAuth(page) {
    const adminUser = {
        id: 1,
        username: "admin",
        name: "Тестовый администратор",
        role: "admin",
        isAdmin: true,
    };

    await page.addInitScript(
        ({ token, adminUser }) => {
            localStorage.setItem("authToken", token);
            localStorage.setItem("adminToken", token);
            localStorage.setItem("token", token);
            localStorage.setItem("userRole", "admin");

            localStorage.setItem(
                "user",
                JSON.stringify(adminUser)
            );

            localStorage.setItem(
                "adminUser",
                JSON.stringify(adminUser)
            );

            localStorage.setItem(
                "currentUser",
                JSON.stringify(adminUser)
            );
        },
        {
            token: ADMIN_TEST_TOKEN,
            adminUser,
        }
    );
}

module.exports = {
    makeAdminToken,
    setAdminAuth,
    ADMIN_TEST_TOKEN,
};