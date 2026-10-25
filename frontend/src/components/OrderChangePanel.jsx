
import React, {
    useCallback,
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";

import SignatureAgreementPanel
    from "./SignatureAgreementPanel";

import ContractSigningPanel
    from "./ContractSigningPanel";

import {
    downloadVerifiedContract,
} from "../utils/downloadVerifiedContract";

const ACTIVE_STATUSES = [
    "pending",
    "approved_pending_agreement",
];

function money(kopecks) {
    return (Number(kopecks || 0) / 100)
        .toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }) + " ₽";
}

export default function OrderChangePanel({ order, userId }) {
    const [changes, setChanges] = useState([]);
    const [additionalWork, setAdditionalWork] = useState("");
    const [newPriceRub, setNewPriceRub] = useState("");
    const [opened, setOpened] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            const response = await axiosInstance.get(
                `/order-changes/order/${order.id}`
            );

            setChanges(response.data?.changes || []);
            setError("");
        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось загрузить изменения заказа"
            );
        } finally {
            setLoading(false);
        }
    }, [order.id]);

    useEffect(() => {
        load();

        const onUpdate = (payload) => {
            if (
                !payload?.orderId ||
                Number(payload.orderId) === Number(order.id)
            ) {
                load();
            }
        };

        socket.on("activeOrdersUpdated", onUpdate);

        return () => {
            socket.off("activeOrdersUpdated", onUpdate);
        };
    }, [load, order.id]);

    if (order.paymentType !== "cash") {
        return null;
    }

    const activeChange = changes.find(
        (change) => ACTIVE_STATUSES.includes(change.status)
    );

    const isAuthor =
        activeChange &&
        Number(activeChange.proposedById) === Number(userId);

    const canPropose =
        order.status === "active" &&
        !activeChange &&
        !(Array.isArray(order.completedBy) &&
            order.completedBy.length > 0);

    const originalPriceKopecks =
        Number(order.finalPriceKopecks) > 0
            ? Number(order.finalPriceKopecks)
            : Math.round(Number(order.proposedSum || 0) * 100);

    const submit = async (event) => {
        event.preventDefault();

        if (busy) return;

        try {
            setBusy(true);
            setError("");

            await axiosInstance.post(
                `/order-changes/order/${order.id}`,
                {
                    additionalWork,
                    newPriceRub,
                }
            );

            setAdditionalWork("");
            setNewPriceRub("");
            setOpened(false);

            await load();
        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось отправить предложение"
            );
        } finally {
            setBusy(false);
        }
    };

    const respond = async (decision) => {
        if (!activeChange || busy) return;

        try {
            setBusy(true);
            setError("");

            await axiosInstance.post(
                `/order-changes/${activeChange.id}/respond`,
                { decision }
            );

            await load();
        } catch (e) {
            setError(
                e.response?.data?.message ||
                "Не удалось обработать предложение"
            );
        } finally {
            setBusy(false);
        }
    };


    const generateAgreement = async () => {
        if (!activeChange || busy) return;

        try {
            setBusy(true);
            setError("");

            await axiosInstance.post(
                `/order-changes/${activeChange.id}/agreement`
            );

            await load();
        } catch (error) {
            setError(
                error.response?.data?.message ||
                "Не удалось создать дополнительное соглашение"
            );
        } finally {
            setBusy(false);
        }
    };

    const downloadAgreement = async (agreement) => {
        try {
            setError("");

            await downloadVerifiedContract(
                agreement.id,
                agreement.version,
                "addendum"
            );
        } catch (error) {
            setError(
                error.message ||
                "Не удалось скачать соглашение"
            );
        }
    };


    return (
        <section style={{
            border: "1px solid #dbe3ef",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
            marginBottom: 16,
        }}>
            <h3 style={{ marginTop: 0 }}>
                Дополнительные работы
            </h3>

            <p style={{ fontSize: 13, color: "#64748b" }}>
                Текущая согласованная стоимость:{" "}
                <strong>{money(originalPriceKopecks)}</strong>
            </p>

            {loading && <p>Загрузка предложений…</p>}

            {error && (
                <p role="alert" style={{ color: "#b91c1c" }}>
                    {error}
                </p>
            )}

            {activeChange && (
                <div style={{
                    padding: 14,
                    borderRadius: 10,
                    background: "#f1f5f9",
                    marginBottom: 12,
                }}>
                    <strong>
                        {activeChange.status === "pending"
                            ? "Предложение ожидает ответа"
                            : "Предложение предварительно согласовано"}
                    </strong>

                    <p style={{ whiteSpace: "pre-wrap" }}>
                        {activeChange.additionalWork}
                    </p>

                    <p>
                        Новая стоимость:{" "}
                        <strong>
                            {money(activeChange.proposedPriceKopecks)}
                        </strong>
                    </p>


                    {activeChange.status ===
                    "approved_pending_agreement" ? (
                        <div style={{
                            display: "grid",
                            gap: 12,
                            marginTop: 12,
                        }}>
                            {activeChange.agreement ? (
                                <>
                                    <div>
                                        <strong>
                                            {activeChange.agreement.documentNumber}
                                        </strong>

                                        <p style={{ fontSize: 13 }}>
                                            Статус:{" "}
                                            {activeChange.agreement.status === "fully_signed"
                                                ? "Подписано обеими сторонами"
                                                : activeChange.agreement.status === "partially_signed"
                                                    ? "Ожидается вторая подпись"
                                                    : "Ожидает подписания"}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            downloadAgreement(activeChange.agreement)
                                        }
                                    >
                                        Скачать дополнительное соглашение (PDF)
                                    </button>

                                    {activeChange.agreement.status !== "fully_signed" && (
                                        <>
                                            <SignatureAgreementPanel />

                                            <ContractSigningPanel
                                                assignment={activeChange.agreement}
                                                onSigned={load}
                                            />
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p style={{ fontSize: 13 }}>
                                        Предложение согласовано. Для изменения цены
                                        необходимо оформить дополнительное соглашение
                                        к подписанному основному договору.
                                    </p>

                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={generateAgreement}
                                    >
                                        {busy
                                            ? "Формируем PDF…"
                                            : "Сформировать дополнительное соглашение"}
                                    </button>
                                </>
                            )}

                            <small>
                                До завершения подписания обеими сторонами
                                действует прежняя стоимость заказа.
                            </small>
                        </div>
                    ) : isAuthor ? (

                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => respond("cancel")}
                        >
                            Отменить предложение
                        </button>
                    ) : (
                        <div style={{
                            display: "flex",
                            gap: 10,
                            flexWrap: "wrap",
                        }}>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => respond("approve")}
                            >
                                Согласовать для оформления
                            </button>

                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => respond("reject")}
                            >
                                Отклонить
                            </button>
                        </div>
                    )}
                </div>
            )}

            {canPropose && !loading && (
                <>
                    <button
                        type="button"
                        onClick={() => setOpened(!opened)}
                    >
                        {opened
                            ? "Скрыть форму"
                            : "Предложить дополнительные работы"}
                    </button>

                    {opened && (
                        <form
                            onSubmit={submit}
                            style={{
                                display: "grid",
                                gap: 12,
                                marginTop: 14,
                            }}
                        >
                            <label>
                                Что нужно добавить или изменить?
                                <textarea
                                    required
                                    minLength={10}
                                    maxLength={2000}
                                    rows={4}
                                    value={additionalWork}
                                    onChange={(e) =>
                                        setAdditionalWork(e.target.value)
                                    }
                                    placeholder="Например: добавить одного грузчика на 2 часа"
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        marginTop: 6,
                                    }}
                                />
                            </label>

                            <label>
                                Новая общая стоимость, ₽
                                <input
                                    required
                                    type="text"
                                    inputMode="decimal"
                                    value={newPriceRub}
                                    onChange={(e) =>
                                        setNewPriceRub(e.target.value)
                                    }
                                    placeholder="6500"
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        marginTop: 6,
                                    }}
                                />
                            </label>

                            <small>
                                Укажите итоговую стоимость всего заказа,
                                а не только цену дополнительных работ.
                            </small>

                            <button type="submit" disabled={busy}>
                                {busy
                                    ? "Отправляем…"
                                    : "Отправить предложение"}
                            </button>
                        </form>
                    )}
                </>
            )}

            {changes.length > 0 && (
                <details style={{ marginTop: 14 }}>
                    <summary>История предложений ({changes.length})</summary>

                    {changes.map((change) => (
                        <div
                            key={change.id}
                            style={{
                                borderTop: "1px solid #e2e8f0",
                                padding: "10px 0",
                                fontSize: 13,
                            }}
                        >
                            <strong>Предложение №{change.id}</strong>
                            <p>{change.additionalWork}</p>
                            <p>
                                {money(change.basePriceKopecks)}
                                {" → "}
                                {money(change.proposedPriceKopecks)}
                            </p>
                            <small>
                                Статус: {change.status}
                            </small>

                            {change.agreement && (
                                <div style={{ marginTop: 8 }}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            downloadAgreement(change.agreement)
                                        }
                                    >
                                        Скачать соглашение №{change.agreement.version}
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </details>
            )}
        </section>
    );
}
