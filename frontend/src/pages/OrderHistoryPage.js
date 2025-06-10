import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import '../styles/OrderHistotyPage.css';

const OrderHistoryPage = () => {
    const { userId } = useParams();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchCompletedOrders = async () => {
        try {
            const response = await axiosInstance.get(`/orders/completed/${userId}`);
            const formattedOrders = response.data.map(order => ({
                ...order,
                completedAt: order.completedAt
                    ? new Date(order.completedAt).toLocaleDateString()
                    : 'Не указана',
            }));
            setOrders(formattedOrders);
        } catch (err) {
            setError(err.response?.data?.message || 'Ошибка загрузки заказов');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCompletedOrders();
    }, [userId]);

    const handleRestore = async (orderId) => {
        try {
            const response = await axiosInstance.post(`/orders/${orderId}/restore`);
            if (response.data.success) {
                alert('Заказ восстановлен!');
                fetchCompletedOrders(); // Обновляем список
            } else {
                alert('Не удалось восстановить заказ');
            }
        } catch (error) {
            console.error('Ошибка при восстановлении:', error);
            alert('Ошибка при восстановлении заказа');
        }
    };

    const handlePay = async (orderId) => {
        try {
            const response = await axiosInstance.post(`/payment/pay-pending/${orderId}`);
            const { paymentUrl } = response.data;
            if (paymentUrl) {
                window.location.href = paymentUrl; // редирект на оплату
            } else {
                alert('Не удалось получить ссылку на оплату');
            }
        } catch (error) {
            console.error('Ошибка при оплате:', error);
            alert('Ошибка при попытке оплаты');
        }
    };


    if (loading) return <div className="loading-message">Загрузка истории заказов...</div>;
    if (error) return <div className="error-message">Ошибка: {error}</div>;

    return (
        <div className="order-history">

            <div className="pageContainer">

                    <div className="contentWrapper">

                        <h1>История заказов ({orders.length})</h1>
                        {orders.length > 0 ? (
                            <ul className="order-list">
                                {[...orders].reverse().map(order => (
                                    <li key={order.id} className="order-item">
                                        <p><strong>№ заказа:</strong> {order.id}</p>
                                        <p><strong>Тип заказа:</strong> {order.type}</p>
                                        <p><strong>Описание:</strong> {order.description}</p>
                                        <p><strong>Адрес:</strong> {order.address}</p>
                                        <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                                        <p>
                                            <strong>Статус:</strong>{' '}
                                            {order.status === 'expired'
                                                ? 'Просрочен'
                                                : order.status === 'pending_payment'
                                                    ? 'Ожидает оплаты'
                                                    : 'Завершён'}
                                        </p>
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

                                        {order.status === 'pending_payment' && (
                                            <button
                                                onClick={() => handlePay(order.id)}
                                                className="pay-button"
                                            >
                                                Оплатить и разместить
                                            </button>
                                        )}

                                        {/* 👇 Кнопка восстановить только для expired заказов */}
                                        {order.status === 'expired' && (
                                            <button onClick={() => handleRestore(order.id)} className="restore-button">
                                                Восстановить заказ
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>Завершенных или просроченных заказов нет.</p>
                        )}
                    </div>
                </div>
            </div>

    );
};

export default OrderHistoryPage;
