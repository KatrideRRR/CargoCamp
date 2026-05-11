export function getReviewKey(orderId, orderType = "regular") {
    return `review_submitted_${orderType}_${orderId}`;
}

export function getReviewReminderKey(orderId, orderType = "regular") {
    return `review_reminder_${orderType}_${orderId}`;
}

export function hasSubmittedReview(orderId, orderType = "regular") {
    if (!orderId) return false;

    const key = getReviewKey(orderId, orderType);
    return localStorage.getItem(key) === "1";
}

export function markReviewSubmitted(orderId, orderType = "regular") {
    if (!orderId) return;

    const key = getReviewKey(orderId, orderType);
    localStorage.setItem(key, "1");

    // После отзыва напоминалку тоже можно убрать
    const reminderKey = getReviewReminderKey(orderId, orderType);
    localStorage.removeItem(reminderKey);
}

export function shouldRemindReview(orderId, orderType = "regular") {
    if (!orderId) return false;

    // ✅ главное: если отзыв уже оставлен — не напоминаем никогда
    if (hasSubmittedReview(orderId, orderType)) {
        return false;
    }

    const key = getReviewReminderKey(orderId, orderType);
    const raw = localStorage.getItem(key);

    if (!raw) return true;

    const lastTs = Number(raw);
    if (!lastTs) return true;

    const day = 24 * 60 * 60 * 1000;
    return Date.now() - lastTs > day;
}

export function markReminded(orderId, orderType = "regular") {
    if (!orderId) return;

    const key = getReviewReminderKey(orderId, orderType);
    localStorage.setItem(key, String(Date.now()));
}