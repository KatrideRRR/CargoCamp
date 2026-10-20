import axios from "axios";

// Этот импорт подключает уже существующие
// пользовательские auth-interceptors к axios.
import "./axiosInstance";

const apiUrl = process.env.REACT_APP_API_URL;

export async function downloadLegacyContract(orderId) {
    const id = Number(orderId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            "Некорректный номер заказа"
        );
    }

    try {
        /*
         * Используем обычный Axios с XHR.
         *
         * В iOS CargoCamp axiosInstance
         * использует CapacitorHttp для JSON,
         * поэтому для получения Blob
         * обращаемся через обычный axios.
         *
         * Общие auth-interceptors уже
         * обрабатывают access token и refresh.
         */
        const response = await axios.get(
            `${apiUrl}/api/orders/${id}/contract-file`,
            {
                responseType: "blob",
                adapter: "xhr",
                timeout: 60000,

                headers: {
                    Accept: "application/pdf",
                },
            }
        );

        const blob = response.data;

        if (
            !(blob instanceof Blob) ||
            !blob.size ||
            !String(blob.type).includes(
                "application/pdf"
            )
        ) {
            throw new Error(
                "Сервер вернул некорректный файл договора"
            );
        }

        const objectUrl =
            URL.createObjectURL(blob);

        try {
            const link =
                document.createElement("a");

            link.href = objectUrl;

            link.download =
                `contract_${id}.pdf`;

            document.body.appendChild(link);

            link.click();

            link.remove();

        } finally {
            // Даём браузеру завершить обработку
            // скачивания перед освобождением Blob.
            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 60000);
        }

        return true;

    } catch (error) {
        const errorBlob =
            error.response?.data;

        if (
            errorBlob instanceof Blob &&
            errorBlob.size < 10000
        ) {
            try {
                const message = JSON.parse(
                    await errorBlob.text()
                )?.message;

                if (message) {
                    throw new Error(message);
                }
            } catch (parseError) {
                if (
                    parseError.message &&
                    parseError.name !== "SyntaxError"
                ) {
                    throw parseError;
                }
            }
        }

        if (error.response?.status === 401) {
            throw new Error(
                "Необходимо повторно авторизоваться"
            );
        }

        if (error.response?.status === 404) {
            throw new Error(
                "Договор не найден или у вас нет доступа"
            );
        }

        throw new Error(
            error.message ||
            "Не удалось скачать договор"
        );
    }
}