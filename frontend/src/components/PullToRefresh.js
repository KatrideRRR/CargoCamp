import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import "../styles/PullToRefresh.css";

const PULL_LIMIT = 90;
const TRIGGER_DISTANCE = 72;

export default function PullToRefresh() {
    const startYRef = useRef(0);
    const pullingRef = useRef(false);
    const refreshingRef = useRef(false);
    const pullDistanceRef = useRef(0);

    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        const platform = Capacitor.getPlatform();

        if (platform !== "android" && platform !== "ios") {
            return;
        }

        const isAtTop = () => {
            const scrollTop =
                window.scrollY ||
                document.documentElement.scrollTop ||
                document.body.scrollTop ||
                0;

            return scrollTop <= 2;
        };

        const shouldIgnoreTarget = (target) => {
            if (!target) return false;

            return Boolean(
                target.closest(
                    "textarea, input, select, button, a, .chat-messages, .modal, .ReactModal__Overlay, .custom-modal-overlay, .drawer, .agreement-modal"
                )
            );
        };

        const setDistance = (value) => {
            pullDistanceRef.current = value;
            setPullDistance(value);
        };

        const finishRefresh = () => {
            refreshingRef.current = false;
            setRefreshing(false);
            setDistance(0);
        };

        const onTouchStart = (e) => {
            if (refreshingRef.current) return;
            if (shouldIgnoreTarget(e.target)) return;
            if (!isAtTop()) return;

            startYRef.current = e.touches[0].clientY;
            pullingRef.current = true;
            setDistance(0);
        };

        const onTouchMove = (e) => {
            if (!pullingRef.current || refreshingRef.current) return;
            if (!isAtTop()) return;

            const currentY = e.touches[0].clientY;
            const diff = currentY - startYRef.current;

            if (diff <= 0) {
                setDistance(0);
                return;
            }

            const distance = Math.min(PULL_LIMIT, diff * 0.45);
            setDistance(distance);

            if (distance > 8) {
                e.preventDefault();
            }
        };

        const onTouchEnd = () => {
            if (!pullingRef.current || refreshingRef.current) {
                pullingRef.current = false;
                setDistance(0);
                return;
            }

            pullingRef.current = false;

            const finalDistance = pullDistanceRef.current;

            if (finalDistance >= TRIGGER_DISTANCE) {
                refreshingRef.current = true;
                setRefreshing(true);
                setDistance(TRIGGER_DISTANCE);

                const event = new CustomEvent("appPullToRefresh", {
                    detail: {
                        done: finishRefresh,
                    },
                });

                window.dispatchEvent(event);

                setTimeout(() => {
                    if (refreshingRef.current) {
                        finishRefresh();
                        window.location.reload();
                    }
                }, 2500);
            } else {
                setDistance(0);
            }
        };

        window.addEventListener("touchstart", onTouchStart, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: false });
        window.addEventListener("touchend", onTouchEnd, { passive: true });
        window.addEventListener("touchcancel", onTouchEnd, { passive: true });

        return () => {
            window.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
            window.removeEventListener("touchend", onTouchEnd);
            window.removeEventListener("touchcancel", onTouchEnd);
        };
    }, []);

    const visible = pullDistance > 0 || refreshing;

    return (
        <div
            className={`pull-refresh ${visible ? "visible" : ""} ${refreshing ? "refreshing" : ""}`}
            style={{
                transform: `translate(-50%, ${visible ? Math.min(pullDistance, TRIGGER_DISTANCE) : -40}px)`,
            }}
        >
            <div className="pull-refresh-circle">
                <span className="pull-refresh-spinner" />
            </div>

            <div className="pull-refresh-text">
                {refreshing
                    ? "Обновляем..."
                    : pullDistance >= TRIGGER_DISTANCE
                        ? "Отпустите для обновления"
                        : "Потяните для обновления"}
            </div>
        </div>
    );
}