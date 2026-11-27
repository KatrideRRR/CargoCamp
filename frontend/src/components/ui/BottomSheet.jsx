import React, {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";

import Modal from "react-modal";
import {
    motion,
    useDragControls,
    useReducedMotion,
} from "framer-motion";

import { X } from "lucide-react";

import "../../styles/ui.css";

const CLOSE_TIMEOUT = 280;

const BottomSheet = ({
                         open = false,
                         onClose,
                         title,
                         description,
                         children,
                         footer,
                         dismissible = true,
                         busy = false,
                         showCloseButton = true,
                         closeOnBackdrop = true,
                         closeOnSwipe = true,
                         fullHeight = false,
                         className = "",
                         ariaLabel = "Дополнительные действия",
                     }) => {
    const titleId = useId();
    const descriptionId = useId();

    const dragControls = useDragControls();
    const reducedMotion = useReducedMotion();

    const panelRef = useRef(null);

    const [viewport, setViewport] = useState(null);

    const canDismiss =
        dismissible &&
        !busy &&
        typeof onClose === "function";

    const requestClose = useCallback(() => {
        if (!canDismiss) return;

        onClose();
    }, [canDismiss, onClose]);

    /*
     * VisualViewport помогает корректно размещать
     * шторку при открытой мобильной клавиатуре.
     */
    useEffect(() => {
        if (!open) return undefined;

        const visualViewport = window.visualViewport;

        if (!visualViewport) return undefined;

        const updateViewport = () => {
            const bottom = Math.max(
                0,
                window.innerHeight -
                visualViewport.height -
                visualViewport.offsetTop
            );

            setViewport({
                height: visualViewport.height,
                bottom,
            });
        };

        updateViewport();

        visualViewport.addEventListener(
            "resize",
            updateViewport
        );

        visualViewport.addEventListener(
            "scroll",
            updateViewport
        );

        window.addEventListener(
            "resize",
            updateViewport
        );

        return () => {
            visualViewport.removeEventListener(
                "resize",
                updateViewport
            );

            visualViewport.removeEventListener(
                "scroll",
                updateViewport
            );

            window.removeEventListener(
                "resize",
                updateViewport
            );

            setViewport(null);
        };
    }, [open]);

    const handleDragEnd = (_, info) => {
        if (!canDismiss || !closeOnSwipe) return;

        const distance = info.offset.y;
        const velocity = info.velocity.y;

        const passedDistance = distance > 100;

        const passedVelocity =
            distance > 24 && velocity > 700;

        if (passedDistance || passedVelocity) {
            requestClose();
        }
    };

    const handleAfterOpen = () => {
        panelRef.current?.focus({
            preventScroll: true,
        });
    };

    const overlayStyle = viewport
        ? {
            height: `${viewport.height}px`,
            bottom: `${viewport.bottom}px`,
            top: "auto",
        }
        : {};

    return (
        <Modal
            isOpen={open}
            onRequestClose={requestClose}
            onAfterOpen={handleAfterOpen}
            closeTimeoutMS={
                reducedMotion ? 0 : CLOSE_TIMEOUT
            }
            shouldCloseOnEsc={canDismiss}
            shouldCloseOnOverlayClick={
                canDismiss && closeOnBackdrop
            }
            shouldFocusAfterRender
            shouldReturnFocusAfterClose
            preventScroll
            ariaHideApp
            aria={{
                labelledby: title
                    ? titleId
                    : undefined,
                describedby: description
                    ? descriptionId
                    : undefined,
            }}
            contentLabel={
                title ? undefined : ariaLabel
            }
            bodyOpenClassName="cc-sheet-open"
            portalClassName="cc-sheet-portal"
            overlayClassName={{
                base: "cc-sheet-overlay",
                afterOpen:
                    "cc-sheet-overlay--after-open",
                beforeClose:
                    "cc-sheet-overlay--before-close",
            }}
            className={{
                base: fullHeight
                    ? "cc-sheet-container cc-sheet-container--full-height"
                    : "cc-sheet-container",
                afterOpen:
                    "cc-sheet-container--after-open",
                beforeClose:
                    "cc-sheet-container--before-close",
            }}
            style={{
                overlay: overlayStyle,
            }}
        >
            <motion.div
                ref={panelRef}
                tabIndex={-1}
                className={[
                    "cc-sheet",
                    fullHeight && "cc-sheet--full-height",
                    className,
                ]
                    .filter(Boolean)
                    .join(" ")}
                drag={
                    canDismiss && closeOnSwipe
                        ? "y"
                        : false
                }
                dragListener={false}
                dragControls={dragControls}
                dragConstraints={{
                    top: 0,
                    bottom: 0,
                }}
                dragElastic={{
                    top: 0,
                    bottom: 0.45,
                }}
                dragMomentum={false}
                onDragEnd={handleDragEnd}
            >
                <div
                    className="cc-sheet__grab-area"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                        if (
                            canDismiss &&
                            closeOnSwipe &&
                            event.isPrimary
                        ) {
                            dragControls.start(event);
                        }
                    }}
                >
                    <span className="cc-sheet__handle" />
                </div>

                {(title ||
                    description ||
                    (showCloseButton &&
                        canDismiss)) && (
                    <header className="cc-sheet__header">
                        <div className="cc-sheet__heading">
                            {title && (
                                <h2
                                    id={titleId}
                                    className="cc-sheet__title"
                                >
                                    {title}
                                </h2>
                            )}

                            {description && (
                                <p
                                    id={descriptionId}
                                    className="cc-sheet__description"
                                >
                                    {description}
                                </p>
                            )}
                        </div>

                        {showCloseButton &&
                            canDismiss && (
                                <button
                                    type="button"
                                    className="cc-sheet__close"
                                    aria-label="Закрыть"
                                    onClick={requestClose}
                                >
                                    <X
                                        size={20}
                                        aria-hidden="true"
                                    />
                                </button>
                            )}
                    </header>
                )}

                <div
                    className="cc-sheet__body"
                    aria-busy={busy || undefined}
                >
                    {children}
                </div>

                {footer && (
                    <footer className="cc-sheet__footer">
                        {footer}
                    </footer>
                )}
            </motion.div>
        </Modal>
    );
};

export default BottomSheet;