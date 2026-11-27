import React from "react";

import BottomSheet from "./BottomSheet";
import Button from "./Button";

const ConfirmSheet = ({
                          open,
                          onClose,
                          onConfirm,
                          title = "Подтвердите действие",
                          description,
                          children,
                          confirmText = "Подтвердить",
                          cancelText = "Отмена",
                          destructive = false,
                          loading = false,
                          confirmDisabled = false,
                          error,
                      }) => {
    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title={title}
            description={description}
            busy={loading}
            footer={
                <div className="cc-sheet__actions">
                    <Button
                        variant={
                            destructive
                                ? "danger"
                                : "primary"
                        }
                        fullWidth
                        size="lg"
                        loading={loading}
                        disabled={
                            confirmDisabled ||
                            typeof onConfirm !==
                            "function"
                        }
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </Button>

                    <Button
                        variant="secondary"
                        fullWidth
                        size="lg"
                        disabled={
                            loading ||
                            typeof onClose !==
                            "function"
                        }
                        onClick={onClose}
                    >
                        {cancelText}
                    </Button>
                </div>
            }
        >
            {children}

            {error && (
                <div
                    role="alert"
                    className="cc-ui-error"
                >
                    {error}
                </div>
            )}
        </BottomSheet>
    );
};

export default ConfirmSheet;