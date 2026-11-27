import React, { useState } from "react";

import {
    render,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";

import "@testing-library/jest-dom";

import Modal from "react-modal";

import Button from "./Button";
import BottomSheet from "./BottomSheet";
import ConfirmSheet from "./ConfirmSheet";

let appRoot;

beforeEach(() => {
    appRoot = document.createElement("div");
    document.body.appendChild(appRoot);

    Modal.setAppElement(appRoot);
});

afterEach(() => {
    appRoot?.remove();
});

const renderInApp = (element) => {
    return render(element, {
        container: appRoot,
    });
};

describe("CargoCamp UI — BottomSheet", () => {
    test("не отображает закрытую шторку", () => {
        renderInApp(
            <BottomSheet
                open={false}
                title="Настройки"
            >
                Содержимое шторки
            </BottomSheet>
        );

        expect(
            screen.queryByRole("dialog")
        ).not.toBeInTheDocument();
    });

    test("отображает заголовок и содержимое", () => {
        renderInApp(
            <BottomSheet
                open
                title="Банковские карты"
                description="Выберите карту"
                onClose={jest.fn()}
            >
                Список карт
            </BottomSheet>
        );

        expect(
            screen.getByRole("dialog", {
                name: "Банковские карты",
            })
        ).toBeInTheDocument();

        expect(
            screen.getByText("Выберите карту")
        ).toBeInTheDocument();

        expect(
            screen.getByText("Список карт")
        ).toBeInTheDocument();
    });

    test("вызывает закрытие по кнопке", () => {
        const onClose = jest.fn();

        renderInApp(
            <BottomSheet
                open
                title="Настройки"
                onClose={onClose}
            >
                Содержимое
            </BottomSheet>
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: "Закрыть",
            })
        );

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("не позволяет закрыть занятую шторку", () => {
        const onClose = jest.fn();

        renderInApp(
            <BottomSheet
                open
                title="Оплата"
                busy
                onClose={onClose}
            >
                Обработка платежа
            </BottomSheet>
        );

        expect(
            screen.queryByRole("button", {
                name: "Закрыть",
            })
        ).not.toBeInTheDocument();

        fireEvent.keyDown(
            screen.getByRole("dialog"),
            {
                key: "Escape",
                code: "Escape",
                keyCode: 27,
            }
        );

        expect(onClose).not.toHaveBeenCalled();
    });

    test("закрывает шторку и снимает блокировку body", async () => {
        const Example = () => {
            const [open, setOpen] = useState(true);

            return (
                <BottomSheet
                    open={open}
                    title="Настройки"
                    onClose={() => setOpen(false)}
                >
                    Содержимое
                </BottomSheet>
            );
        };

        renderInApp(<Example />);

        expect(document.body).toHaveClass(
            "cc-sheet-open"
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: "Закрыть",
            })
        );

        await waitFor(() => {
            expect(
                screen.queryByRole("dialog")
            ).not.toBeInTheDocument();

            expect(document.body).not.toHaveClass(
                "cc-sheet-open"
            );
        });
    });
});

describe("CargoCamp UI — Button", () => {
    test("кнопка вызывает обработчик нажатия", () => {
        const onClick = jest.fn();

        renderInApp(
            <Button onClick={onClick}>
                Сохранить
            </Button>
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: "Сохранить",
            })
        );

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("блокирует повторное нажатие при загрузке", () => {
        const onClick = jest.fn();

        renderInApp(
            <Button
                loading
                onClick={onClick}
            >
                Оплатить
            </Button>
        );

        const button = screen.getByRole(
            "button",
            {
                name: "Оплатить",
            }
        );

        expect(button).toBeDisabled();

        expect(button).toHaveAttribute(
            "aria-busy",
            "true"
        );

        fireEvent.click(button);

        expect(onClick).not.toHaveBeenCalled();
    });
});

describe("CargoCamp UI — ConfirmSheet", () => {
    test("передаёт подтверждение и отмену", () => {
        const onConfirm = jest.fn();
        const onClose = jest.fn();

        renderInApp(
            <ConfirmSheet
                open
                title="Отменить заказ?"
                confirmText="Да, отменить"
                cancelText="Оставить заказ"
                destructive
                onConfirm={onConfirm}
                onClose={onClose}
            />
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: "Да, отменить",
            })
        );

        expect(onConfirm).toHaveBeenCalledTimes(1);

        fireEvent.click(
            screen.getByRole("button", {
                name: "Оставить заказ",
            })
        );

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("блокирует действия при выполнении операции", () => {
        const onConfirm = jest.fn();
        const onClose = jest.fn();

        renderInApp(
            <ConfirmSheet
                open
                title="Оплата"
                confirmText="Оплатить"
                cancelText="Отмена"
                loading
                onConfirm={onConfirm}
                onClose={onClose}
            />
        );

        const confirmButton = screen.getByRole(
            "button",
            {
                name: "Оплатить",
            }
        );

        const cancelButton = screen.getByRole(
            "button",
            {
                name: "Отмена",
            }
        );

        expect(confirmButton).toBeDisabled();
        expect(cancelButton).toBeDisabled();

        fireEvent.click(confirmButton);
        fireEvent.click(cancelButton);

        expect(onConfirm).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    test("отображает ошибку операции", () => {
        renderInApp(
            <ConfirmSheet
                open
                title="Оплата"
                error="Не удалось выполнить платёж"
                onConfirm={jest.fn()}
                onClose={jest.fn()}
            />
        );

        expect(
            screen.getByRole("alert")
        ).toHaveTextContent(
            "Не удалось выполнить платёж"
        );
    });
});