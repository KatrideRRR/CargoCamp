import React, { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import "../styles/MessagesPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function MessagesPage() {
    const { orderId } = useParams();
    const [messages, setMessages] = useState([]);
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const token = localStorage.getItem("authToken");

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [messagesRes, orderRes] = await Promise.all([
                    axios.get(`${apiUrl}/api/admin/orders/${orderId}/messages`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                    axios.get(`${apiUrl}/api/admin/orders/${orderId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                ]);

                setMessages(messagesRes.data || []);
                setOrder(orderRes.data || null);
                setLoading(false);
            } catch (err) {
                console.error("Ошибка загрузки сообщений:", err);
                setError("Не удалось загрузить сообщения");
                setLoading(false);
            }
        };

        fetchData();
    }, [orderId, token]);

    const getMessageRole = (msg) => {
        const senderId = msg.senderId || msg.sender?.id;

        if (order?.creatorId && Number(senderId) === Number(order.creatorId)) {
            return {
                label: `Заказчик #${senderId}`,
                rowClass: "creator",
                bubbleClass: "creator",
            };
        }

        if (order?.executorId && Number(senderId) === Number(order.executorId)) {
            return {
                label: `Исполнитель #${senderId}`,
                rowClass: "executor",
                bubbleClass: "executor",
            };
        }

        return {
            label: senderId ? `Участник #${senderId}` : "Неизвестный участник",
            rowClass: "neutral",
            bubbleClass: "neutral",
        };
    };

    if (loading) {
        return (
            <div className="messages-page">
                <div className="messages-wrap">
                    <h2 className="messages-title">Переписка по заказу #{orderId}</h2>
                    <div className="messages-state-card">Загрузка...</div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="messages-page">
                <div className="messages-wrap">
                    <h2 className="messages-title">Переписка по заказу #{orderId}</h2>
                    <div className="messages-state-card messages-state-error">{error}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="messages-page">
            <div className="messages-wrap">
                <h2 className="messages-title">Переписка по заказу #{orderId}</h2>

                <div className="chat-participants-card">
                    <div className="participant-chip creator">
                        Заказчик: {order?.creatorId ? `#${order.creatorId}` : "—"}
                    </div>
                    <div className="participant-chip executor">
                        Исполнитель: {order?.executorId ? `#${order.executorId}` : "—"}
                    </div>
                </div>

                {messages.length > 0 ? (
                    <div className="chat-thread">
                        {messages.map((msg) => {
                            const role = getMessageRole(msg);

                            return (
                                <div key={msg.id} className={`chat-row ${role.rowClass}`}>
                                    <div className={`chat-bubble ${role.bubbleClass}`}>
                                        <div className="chat-meta">
                                            <span className={`chat-role-badge ${role.bubbleClass}`}>
                                                {role.label}
                                            </span>

                                            <span className="chat-time">
                                                {msg.createdAt
                                                    ? new Date(msg.createdAt).toLocaleString()
                                                    : "—"}
                                            </span>
                                        </div>

                                        <div className="chat-author-name">
                                            {msg.sender?.username || "Без имени"}
                                        </div>

                                        <div className="chat-text">
                                            {msg.content || "—"}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="messages-state-card">Сообщения не найдены.</div>
                )}
            </div>
        </div>
    );
}

export default MessagesPage;