export function openPaymentPage(rawUrl) {
    const url = new URL(rawUrl);

    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password
    ) {
        throw new Error(
            "Некорректная ссылка на банковский интерфейс"
        );
    }

    window.location.href = url.href;
}