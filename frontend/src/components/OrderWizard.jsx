import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    useLocation,
    useNavigate,
} from "react-router-dom";

import {
    ArrowLeft,
    ArrowRight,
    Check,
    Pencil,
    TriangleAlert,
    Trash2,
} from "lucide-react";

import {
    BottomSheet,
    Button,
} from "./ui";

import { useAuth } from "../utils/authContext";

import "../styles/OrderWizard.css";


const WizardContext = createContext(null);


export function getOrderComposerBackground(location) {
    if (
        !["/create-order", "/express"]
            .includes(location.pathname)
    ) {
        return null;
    }

    const background =
        location.state?.orderComposerBackground;

    if (
        !background ||
        typeof background.pathname !== "string" ||
        !/^\/my-orders\/[1-9]\d*$/
            .test(background.pathname)
    ) {
        return null;
    }

    return background;
}


export function OrderWizardStep({
                                    number,
                                    children,
                                }) {
    const context =
        useContext(WizardContext);

    if (
        !context ||
        context.activeStep !== number
    ) {
        return null;
    }

    return (
        <section
            className="cc-order-wizard__step"
            data-order-step={number}
            data-direction={context.direction}
            aria-label={
                `Шаг ${number}: ` +
                context.steps[number - 1]
            }
        >
            {children}
        </section>
    );
}


export function OrderReview({
                                groups,
                                payment,
                                onEdit,
                            }) {
    return (
        <div className="cc-order-review">

            {groups.map((group) => (
                <section
                    className="cc-order-review__group"
                    key={group.step}
                >
                    <div className="cc-order-review__head">

                        <h3>{group.title}</h3>

                        <button
                            type="button"
                            className="cc-order-review__edit"
                            aria-label={
                                `Изменить: ${group.title}`
                            }
                            onClick={() =>
                                onEdit(group.step)
                            }
                        >
                            <Pencil
                                size={16}
                                aria-hidden="true"
                            />

                            Изменить
                        </button>

                    </div>

                    <dl className="cc-order-review__fields">

                        {group.fields.map((field) => (
                            <div
                                className="cc-order-review__field"
                                key={field.label}
                            >
                                <dt>{field.label}</dt>

                                <dd>
                                    {field.value == null ||
                                    field.value === ""
                                        ? "Не указано"
                                        : field.value}
                                </dd>
                            </div>
                        ))}

                    </dl>
                </section>
            ))}

            <section className="cc-order-review__payment">

                <span>
                    К оплате сейчас
                </span>

                <strong>
                    {payment}
                </strong>

                <p>
                    Проверьте данные заказа перед публикацией.
                    Оплата работы производится исполнителю
                    согласно выбранному способу оплаты.
                </p>

            </section>

        </div>
    );
}


export function OrderPhotoPreview({
                                      file,
                                      index,
                                      onRemove,
                                  }) {
    const [url, setUrl] =
        useState("");

    useEffect(() => {
        const objectUrl =
            URL.createObjectURL(file);

        setUrl(objectUrl);

        return () => {
            URL.revokeObjectURL(objectUrl);
        };
    }, [file]);

    return (
        <div className="cc-order-photo">

            {url && (
                <img
                    src={url}
                    alt={`Фото ${index + 1}`}
                />
            )}

            <button
                type="button"
                aria-label={
                    `Удалить фото ${index + 1}`
                }
                className="cc-order-photo__remove"
                onClick={onRemove}
            >
                <Trash2
                    size={17}
                    aria-hidden="true"
                />
            </button>

            <span>
                Фото {index + 1}
            </span>

        </div>
    );
}


export default function OrderWizard({
                                        title,
                                        steps,
                                        step,
                                        onStepChange,
                                        onNext,
                                        onPublish,
                                        busy = false,
                                        dirty = false,
                                        error,
                                        errorClassName = "",
                                        auxiliary = null,
                                        contentClassName = "",
                                        children,
                                    }) {
    const navigate = useNavigate();
    const location = useLocation();

    const { user } = useAuth();

    const [confirmClose, setConfirmClose] =
        useState(false);

    const previousStep = useRef(step);
    const contentRef = useRef(null);

    const direction =
        step < previousStep.current
            ? -1
            : 1;

    const auxiliaryTitle =
        auxiliary?.title || "";

    useEffect(() => {
        previousStep.current = step;
    }, [step]);

    useEffect(() => {
        const frame =
            requestAnimationFrame(() => {
                const element =
                    contentRef.current;

                if (!element) return;

                const body = element.closest(
                    ".cc-sheet__body"
                );

                if (body) {
                    body.scrollTop = 0;
                }

                element.focus({
                    preventScroll: true,
                });
            });

        return () =>
            cancelAnimationFrame(frame);

    }, [
        step,
        auxiliaryTitle,
        confirmClose,
    ]);

    const closeComposer = () => {
        if (busy) return;

        if (
            getOrderComposerBackground(location)
        ) {
            navigate(-1);
            return;
        }

        navigate(
            user?.id
                ? `/my-orders/${user.id}`
                : "/",
            {
                replace: true,
            }
        );
    };

    const requestClose = () => {
        if (busy) return;

        if (confirmClose) {
            setConfirmClose(false);
            return;
        }

        if (auxiliary) {
            auxiliary.onBack?.();
            return;
        }

        if (dirty) {
            setConfirmClose(true);
            return;
        }

        closeComposer();
    };

    const lastStep =
        step === steps.length;

    const footer = confirmClose ? (
        <div className="cc-sheet__actions">

            <Button
                variant="secondary"
                fullWidth
                onClick={() =>
                    setConfirmClose(false)
                }
            >
                Продолжить редактирование
            </Button>

            <Button
                variant="danger"
                fullWidth
                onClick={closeComposer}
            >
                Закрыть без сохранения
            </Button>

        </div>
    ) : auxiliary ? (
        <Button
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={auxiliary.onBack}
            leftIcon={<ArrowLeft size={18} />}
        >
            Назад к заказу
        </Button>
    ) : (
        <div className="cc-order-wizard__actions">

            {step > 1 && (
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                        onStepChange(step - 1)
                    }
                    leftIcon={
                        <ArrowLeft size={18} />
                    }
                >
                    Назад
                </Button>
            )}

            <Button
                fullWidth
                loading={busy}
                onClick={
                    lastStep
                        ? onPublish
                        : onNext
                }
                rightIcon={
                    !lastStep
                        ? <ArrowRight size={18} />
                        : undefined
                }
            >
                {lastStep
                    ? "Создать заказ"
                    : "Далее"}
            </Button>

        </div>
    );

    return (
        <BottomSheet
            open
            fullHeight
            title={
                confirmClose
                    ? "Закрыть заказ?"
                    : auxiliaryTitle || title
            }
            description={
                !confirmClose && !auxiliary
                    ? `Шаг ${step} из ${steps.length}`
                    : undefined
            }
            className="cc-order-wizard"
            busy={busy}
            closeOnBackdrop={false}
            onClose={requestClose}
            footer={footer}
        >
            <div
                ref={contentRef}
                tabIndex={-1}
                className="cc-order-wizard__focus"
            >

                {confirmClose ? (
                    <div className="cc-order-wizard__discard">

                        <TriangleAlert
                            size={42}
                            aria-hidden="true"
                        />

                        <h3>
                            Несохранённые данные
                        </h3>

                        <p>
                            Если закрыть создание заказа,
                            введённые данные будут потеряны.
                        </p>

                    </div>
                ) : auxiliary ? (
                    auxiliary.content
                ) : (
                    <>

                        <nav
                            className="cc-order-wizard__progress"
                            aria-label="Шаги создания заказа"
                        >
                            {steps.map((label, index) => {
                                const number = index + 1;

                                return (
                                    <button
                                        type="button"
                                        key={label}
                                        disabled={busy}
                                        aria-label={
                                            `Шаг ${number}: ${label}`
                                        }
                                        aria-current={
                                            step === number
                                                ? "step"
                                                : undefined
                                        }
                                        className={
                                            "cc-order-wizard__progress-item" +
                                            (number === step
                                                ? " is-current"
                                                : "") +
                                            (number < step
                                                ? " is-complete"
                                                : "")
                                        }
                                        onClick={() =>
                                            onStepChange(number)
                                        }
                                    >

                                        <span className="cc-order-wizard__number">

                                            {number < step
                                                ? <Check size={14} />
                                                : number}

                                        </span>

                                        <span>
                                            {label}
                                        </span>

                                    </button>
                                );
                            })}
                        </nav>

                        <h3 className="cc-order-wizard__heading">
                            {steps[step - 1]}
                        </h3>

                        {error && (
                            <div
                                role="alert"
                                className="cc-ui-error cc-order-wizard__error"
                            >
                                <span
                                    className={errorClassName}
                                >
                                    {error}
                                </span>
                            </div>
                        )}

                        <WizardContext.Provider
                            value={{
                                activeStep: step,
                                direction,
                                steps,
                            }}
                        >
                            <div
                                className={
                                    `cc-order-composer-content ${contentClassName}`
                                }
                            >
                                {children}
                            </div>
                        </WizardContext.Provider>

                    </>
                )}

            </div>
        </BottomSheet>
    );
}