import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import '../styles/OrderHistotyPage.css';

const OrderHistoryPage = () => {
    const { userId } = useParams(); // Получаем ID пользователя из URL
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCompletedOrders = async () => {
            try {
                const response = await axiosInstance.get(`/orders/completed/${userId}`);
                const formattedOrders = response.data.map(order => ({
                    ...order,
                    // Преобразуем строку с датой в объект Date и форматируем её
                    completedAt: order.completedAt ? new Date(order.completedAt).toLocaleDateString() : 'Не указана',
                }));
                setOrders(formattedOrders);
            } catch (err) {
                setError(err.response?.data?.message || 'Ошибка загрузки заказов');
            } finally {
                setLoading(false);
            }
        };

        fetchCompletedOrders();
    }, [userId]);

    if (loading) {
        return <div className="loading-message">Загрузка истории заказов...</div>;
    }

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    return (
        <div className="order-history-container">
            <h1>История завершенных заказов ({orders.length})</h1>
            {orders.length > 0 ? (
                <ul className="order-list">
                    {orders.map((order) => (
                        <li key={order.id} className="order-item">
                            <p><strong>№ заказа:</strong> {order.id}</p>
                            <p><strong>Тип заказа:</strong> {order.type}</p>
                            <p><strong>Описание:</strong> {order.description}</p>
                            <p><strong>Адрес:</strong> {order.address}</p>
                            <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                            <p><strong>ID создателя:</strong> {order.creatorId}</p>
                            <p><strong>ID исполнителя:</strong> {order.executorId}</p>
                            <p><strong>Дата завершения:</strong> {order.completedAt}</p>
                            {order.contractPath && (
                                <a
                                    href={`http://localhost:5001/${order.contractPath.replace(/^.*contracts[\\/]/, 'contracts/')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Скачать договор (PDF)
                                </a>
                            )}

                        </li>
                    ))}
                </ul>
            ) : (
                <p>Завершенных заказов нет.</p>
            )}
        </div>
    );
};

export default OrderHistoryPage;
