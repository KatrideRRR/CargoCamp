import React from "react";

import {
    render,
    screen,
    fireEvent,
} from "@testing-library/react";

import "@testing-library/jest-dom";

import TextField from "./TextField";
import SectionCard from "./SectionCard";
import SettingsRow from "./SettingsRow";
import StatusBadge from "./StatusBadge";
import EmptyState from "./EmptyState";
import LoadingState from "./LoadingState";


describe("CargoCamp UI — TextField", () => {
    test("связывает заголовок с полем ввода", () => {
        render(
            <TextField
                label="Имя"
                placeholder="Введите имя"
            />
        );

        expect(
            screen.getByRole("textbox", {
                name: "Имя",
            })
        ).toBeInTheDocument();
    });

    test("работает без видимого заголовка", () => {
        const onChange = jest.fn();

        render(
            <TextField
                aria-label="Адрес"
                placeholder="Укажите адрес"
                onChange={onChange}
            />
        );

        const input = screen.getByRole(
            "textbox",
            {
                name: "Адрес",
            }
        );

        fireEvent.change(input, {
            target: {
                value: "Симферополь",
            },
        });

        expect(onChange).toHaveBeenCalledTimes(1);

        expect(input).toHaveValue(
            "Симферополь"
        );
    });

    test("отображает ошибку и связывает её с полем", () => {
        render(
            <TextField
                label="Телефон"
                error="Некорректный номер телефона"
            />
        );

        const input = screen.getByRole(
            "textbox",
            {
                name: "Телефон",
            }
        );

        expect(input).toHaveAttribute(
            "aria-invalid",
            "true"
        );

        expect(
            screen.getByRole("alert")
        ).toHaveTextContent(
            "Некорректный номер телефона"
        );

        expect(
            input
        ).toHaveAccessibleDescription(
            "Некорректный номер телефона"
        );
    });

    test("поддерживает многострочный ввод", () => {
        render(
            <TextField
                multiline
                label="Описание"
                rows={5}
            />
        );

        const input = screen.getByRole(
            "textbox",
            {
                name: "Описание",
            }
        );

        expect(input.tagName).toBe("TEXTAREA");

        expect(input).toHaveAttribute(
            "rows",
            "5"
        );
    });

    test("поддерживает disabled", () => {
        render(
            <TextField
                label="Телефон"
                disabled
            />
        );

        expect(
            screen.getByRole("textbox", {
                name: "Телефон",
            })
        ).toBeDisabled();
    });
});


describe("CargoCamp UI — SectionCard", () => {
    test("отображает заголовок и содержимое", () => {
        render(
            <SectionCard title="Банковские карты">
                Список карт
            </SectionCard>
        );

        expect(
            screen.getByRole("heading", {
                name: "Банковские карты",
            })
        ).toBeInTheDocument();

        expect(
            screen.getByText("Список карт")
        ).toBeInTheDocument();
    });
});


describe("CargoCamp UI — SettingsRow", () => {
    test("открывает выбранный раздел", () => {
        const onClick = jest.fn();

        render(
            <SettingsRow
                title="Банковские карты"
                onClick={onClick}
            />
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: "Банковские карты",
            })
        );

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("не вызывает действие при disabled", () => {
        const onClick = jest.fn();

        render(
            <SettingsRow
                title="Верификация"
                disabled
                onClick={onClick}
            />
        );

        const button = screen.getByRole(
            "button",
            {
                name: "Верификация",
            }
        );

        expect(button).toBeDisabled();

        fireEvent.click(button);

        expect(onClick).not.toHaveBeenCalled();
    });

    test("поддерживает информационную строку без действия", () => {
        render(
            <SettingsRow
                title="Статус ПЭП"
                value="Активирован"
            />
        );

        expect(
            screen.getByText("Статус ПЭП")
        ).toBeInTheDocument();

        expect(
            screen.getByText("Активирован")
        ).toBeInTheDocument();

        expect(
            screen.queryByRole("button")
        ).not.toBeInTheDocument();
    });
});


describe("CargoCamp UI — StatusBadge", () => {
    test("отображает статус с выбранным оформлением", () => {
        render(
            <StatusBadge tone="success">
                Выполнен
            </StatusBadge>
        );

        expect(
            screen.getByText("Выполнен")
        ).toHaveClass(
            "cc-status-badge--success"
        );
    });

    test("использует нейтральное оформление для неизвестного tone", () => {
        render(
            <StatusBadge tone="unknown">
                Новый статус
            </StatusBadge>
        );

        expect(
            screen.getByText("Новый статус")
        ).toHaveClass(
            "cc-status-badge--neutral"
        );
    });
});


describe("CargoCamp UI — EmptyState", () => {
    test("отображает пустое состояние и действие", () => {
        const onAction = jest.fn();

        render(
            <EmptyState
                title="Нет заказов"
                description="Создайте первый заказ"
                actionLabel="Создать заказ"
                onAction={onAction}
            />
        );

        expect(
            screen.getByRole("heading", {
                name: "Нет заказов",
            })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Создать заказ",
            })
        );

        expect(onAction).toHaveBeenCalledTimes(1);
    });

    test("не отображает кнопку без обработчика", () => {
        render(
            <EmptyState
                title="Нет сообщений"
                actionLabel="Продолжить"
            />
        );

        expect(
            screen.queryByRole("button")
        ).not.toBeInTheDocument();
    });
});


describe("CargoCamp UI — LoadingState", () => {
    test("отображает доступный индикатор загрузки", () => {
        render(
            <LoadingState
                title="Загружаем заказы"
            />
        );

        expect(
            screen.getByRole("status")
        ).toHaveTextContent(
            "Загружаем заказы"
        );
    });

    test("поддерживает полноэкранный режим", () => {
        render(
            <LoadingState fullPage />
        );

        expect(
            screen.getByRole("status")
        ).toHaveClass(
            "cc-loading-state--page"
        );
    });
});