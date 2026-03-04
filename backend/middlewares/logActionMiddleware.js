// middlewares/logActionMiddleware.js
module.exports = function logActionMiddleware(req, res, next) {
    // если функция уже есть — ничего не делаем
    if (typeof req.logAction === "function") return next();

    // пробуем взять из app.locals
    const fn = req.app?.locals?.logAction;

    if (typeof fn === "function") {
        req.logAction = fn;
        return next();
    }

    // если логгер не подключён — не падаем, просто пустышка
    req.logAction = async () => {};
    return next();
};