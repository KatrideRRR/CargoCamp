export function shouldRemindReview(orderId) {
    const key = `review_reminder_${orderId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return true;

    const lastTs = Number(raw);
    if (!lastTs) return true;

    // напоминать не чаще раза в 24 часа
    const day = 24 * 60 * 60 * 1000;
    return Date.now() - lastTs > day;
}

export function markReminded(orderId) {
    const key = `review_reminder_${orderId}`;
    localStorage.setItem(key, String(Date.now()));
}