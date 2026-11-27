import React from "react";

import {
    render,
    screen,
    waitFor,
} from "@testing-library/react";

import YandexMapModal from "./YandexMapModal";

jest.mock("../utils/orderNavigation", () => ({
    getOrderCoordinatesForMap: jest.fn(),
}));

describe("YandexMapModal", () => {
    const previousApiKey =
        process.env.REACT_APP_YANDEX_API_KEY;

    beforeEach(() => {
        delete process.env.REACT_APP_YANDEX_API_KEY;
    });

    afterEach(() => {
        if (previousApiKey === undefined) {
            delete process.env.REACT_APP_YANDEX_API_KEY;
        } else {
            process.env.REACT_APP_YANDEX_API_KEY =
                previousApiKey;
        }
    });

    test("не отображает закрытую карту", () => {
        const { container } = render(
            <YandexMapModal
                embedded
                isOpen={false}
            />
        );

        expect(
            container.querySelector(
                ".cc-embedded-map"
            )
        ).toBeNull();
    });

    test("отображает встроенную карту без отдельного overlay", () => {
        const { container } = render(
            <YandexMapModal
                embedded
                isOpen
            />
        );

        expect(
            container.querySelector(
                ".cc-embedded-map"
            )
        ).toBeInTheDocument();

        expect(
            document.querySelector(
                ".yandex-map-modal-overlay"
            )
        ).toBeNull();
    });

    test("не разрешает подтверждение без выбранной точки", () => {
        render(
            <YandexMapModal
                embedded
                isOpen
            />
        );

        expect(
            screen.getByRole("button", {
                name: "Подтвердить местоположение",
            })
        ).toBeDisabled();
    });

    test("сохраняет управление прокруткой за родительской шторкой", () => {
        const previousOverflow =
            document.body.style.overflow;

        document.body.style.overflow = "auto";

        try {
            const { unmount } = render(
                <YandexMapModal
                    embedded
                    isOpen
                />
            );

            expect(
                document.body.style.overflow
            ).toBe("auto");

            unmount();

            expect(
                document.body.style.overflow
            ).toBe("auto");
        } finally {
            document.body.style.overflow =
                previousOverflow;
        }
    });

    test("сохраняет прежний режим модального окна", () => {
        render(
            <YandexMapModal
                isOpen
                onClose={jest.fn()}
            />
        );

        expect(
            document.querySelector(
                ".yandex-map-modal-overlay"
            )
        ).toBeInTheDocument();
    });

    test("сообщает об отсутствии API-ключа", async () => {
        render(
            <YandexMapModal
                embedded
                isOpen
            />
        );

        await waitFor(() => {
            expect(
                screen.getByRole("alert")
            ).toHaveTextContent(
                "Нет REACT_APP_YANDEX_API_KEY"
            );
        });
    });
});