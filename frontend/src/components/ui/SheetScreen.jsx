import React, { useEffect, useRef } from "react";
import {
    AnimatePresence,
    motion,
    useReducedMotion,
} from "framer-motion";

import { ChevronLeft } from "lucide-react";

import "../../styles/ui.css";

const SheetScreen = ({
                         screen,
                         direction = 1,
                         onBack,
                         busy = false,
                         children,
                     }) => {
    const reducedMotion = useReducedMotion();
    const screenRef = useRef(null);

    useEffect(() => {
        screenRef.current?.focus({
            preventScroll: true,
        });
    }, [screen]);

    const variants = {
        enter: (dir) => ({
            x: reducedMotion ? 0 : dir * 48,
            opacity: 0,
        }),

        center: {
            x: 0,
            opacity: 1,
        },

        exit: (dir) => ({
            x: reducedMotion ? 0 : dir * -48,
            opacity: 0,
        }),
    };

    return (
        <div className="cc-sheet-screen">

            {onBack && (
                <button
                    type="button"
                    className="cc-sheet-screen__back"
                    onClick={onBack}
                    disabled={busy}
                >
                    <ChevronLeft
                        size={21}
                        aria-hidden="true"
                    />

                    Назад
                </button>
            )}

            <AnimatePresence
                initial={false}
                mode="wait"
                custom={direction}
            >
                <motion.div
                    key={screen}
                    custom={direction}
                    variants={variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                        duration: reducedMotion
                            ? 0
                            : 0.18,
                        ease: "easeOut",
                    }}
                    className="cc-sheet-screen__content"
                    ref={screenRef}
                    tabIndex={-1}
                >
                    {children}
                </motion.div>
            </AnimatePresence>

        </div>
    );
};

export default SheetScreen;