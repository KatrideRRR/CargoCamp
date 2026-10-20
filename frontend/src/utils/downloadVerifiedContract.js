
import axios from "axios";

// Подключает действующие auth-interceptors
// пользовательской сессии CargoCamp.
import "./axiosInstance";

const apiUrl = process.env.REACT_APP_API_URL;

export async function downloadVerifiedContract(
    contractId,
    version = 1
) {
    const id = Number(contractId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            "Некорректный номер договора"
        );
    }

    try {
        const response = await axios.get(
            `${apiUrl}/api/contracts/${id}/file`,
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
            blob.size > 20 * 1024 * 1024
        ) {
            throw new Error(
                "Получен некорректный PDF"
            );
        }

        const signature = await blob
            .slice(0, 5)
            .text();

        if (signature !== "%PDF-") {
            throw new Error(
                "Сервер вернул не PDF-документ"
            );
        }

        const objectUrl =
            URL.createObjectURL(blob);

        try {
            const link =
                document.createElement("a");

            link.href = objectUrl;

            link.download =
                `verified_contract_${id}_v${version}.pdf`;

            document.body.appendChild(link);
            link.click();
            link.remove();

        } finally {
            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
            }, 60000);
        }

        return true;

    } catch (error) {
        const status = error.response?.status;

        let serverMessage = "";

        const data = error.response?.data;

        if (
            data instanceof Blob &&
            data.size < 10000
        ) {
            try {
                const parsed = JSON.parse(
                    await data.text()
                );

                serverMessage =
                    parsed?.message || "";
            } catch {
                // Ответ мог быть не JSON.
            }
        }

        if (status === 401) {
            throw new Error(
                "Сессия завершена. Войдите повторно."
            );
        }

        if (status === 404) {
            throw new Error(
                "Договор не найден или недоступен"
            );
        }

        if (status === 409) {
            throw new Error(
                "Нарушена целостность PDF. " +
                "Обратитесь в поддержку CargoCamp."
            );
        }

        throw new Error(
            serverMessage ||
            error.message ||
            "Не удалось скачать договор"
        );
    }
}
