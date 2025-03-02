import { io } from 'socket.io-client';
import React, {useState, useEffect, useCallback, useRef} from 'react';
import axios from 'axios';
import {useParams} from 'react-router-dom';
import '../styles/ChatPage.css';
import {useUser} from '../utils/userContext';
const apiUrl = process.env.REACT_APP_API_URL;

const ChatPage = () => {
    const {orderId} = useParams();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const {currentUser} = useUser();
    const [selectedUser, setSelectedUser] = useState(null);
    const messagesEndRef = useRef(null);
    const socket = useRef(null); // Храним WebSocket соединение

    useEffect(() => {
        // Подключаемся к серверу
        socket.current = io(process.env.REACT_APP_SOCKET_URL);

        if (currentUser) {
            // Присоединяемся к чату с нашим userId
            socket.current.emit('joinChat', { userId: currentUser.id });

            // Слушаем входящие сообщения
            socket.current.on('receiveMessage', (message) => {
                console.log('Получено новое сообщение:', message);
                setMessages((prev) => [...prev, message]); // Обновляем список сообщений
            });
        }

        return () => {
            // Отключаемся при размонтировании
            socket.current.disconnect();
        };
    }, [currentUser]);

    // Функция для прокрутки вниз
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
    };

    // Прокрутка вниз при добавлении новых сообщений
    useEffect(() => {
        scrollToBottom();
    }, [messages]); // Запускается при изменении списка сообщений


    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                const {data: order} = await axios.get(`${apiUrl}/api/orders/${orderId}`, {
                    headers: {Authorization: `Bearer ${localStorage.getItem('authToken')}`},
                });

                const userId = order.creatorId === currentUser.id ? order.executorId : order.creatorId;
                const {data: user} = await axios.get(`${apiUrl}/api/auth/${userId}`);
                setSelectedUser(user);

                const {data: messagesData} = await axios.get(`${apiUrl}/api/messages/${orderId}`, {
                    headers: {Authorization: `Bearer ${localStorage.getItem('authToken')}`},
                });
                setMessages(messagesData);
            } catch (err) {
                console.error('Ошибка загрузки данных:', err);
                setError('Не удалось загрузить данные чата.');
            } finally {
                setLoading(false);
            }
        };

        if (orderId && currentUser) {
            fetchData();

        }
    }, [orderId, currentUser]);

    const handleSendMessage = useCallback(async () => {
        if (!newMessage.trim() || !currentUser || !orderId || !selectedUser) return;

        try {
            const messageData = {
                content: newMessage,
                senderId: currentUser.id,
                receiverId: selectedUser.id,
                orderId
            };

            // Отправляем сообщение в базу данных через API
            const { data } = await axios.post(
                `${apiUrl}/api/messages`,
                messageData,
                { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
            );

            // Отправляем сообщение через WebSocket
            socket.current.emit('sendMessage', data);

            // Добавляем в локальный список сообщений
            setMessages((prev) => [...prev, data]);

            // Очищаем поле ввода
            setNewMessage('');
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
            setError('Не удалось отправить сообщение.');
        }
    }, [newMessage, orderId, currentUser, selectedUser]);


    if (loading) {
        return <div className="chat-page">Загрузка чата...</div>;
    }

    if (error) {
        return <div className="chat-page">Ошибка: {error}</div>;
    }

    return (
        <div className="chat-page">
            <div className="chat-container">
                <header className="chat-header">
                    Чат для заказа #{orderId} с {selectedUser?.username}
                </header>
                <div className="chat-messages" style={{overflowY: "auto", maxHeight: "auto"}}>
                    {messages.length > 0 ? (
                        messages.map((msg) => (
                            <div
                                key={msg.id}

                                className={`chat-message ${
                                    msg.senderId === currentUser.id ? 'chat-message-sent' : 'chat-message-received'
                                }`}
                            >
                                <p>{msg.content}</p>
                                <div ref={messagesEndRef}/>
                            </div>

                        ))
                    ) : (
                        <div className="chat-empty">Нет сообщений</div>
                    )}
                </div>

                <div className="chat-input-container">
                    <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Введите сообщение..."
                        className="chat-input"
                        rows="1"
                        onInput={(e) => {
                            const textarea = e.target;
                            textarea.style.height = 'auto'; // Сбрасываем высоту
                            textarea.style.height = textarea.scrollHeight + 'px'; // Устанавливаем новую высоту

                            // Обновляем CSS-переменную
                            document.documentElement.style.setProperty('--chat-input-height', `${textarea.scrollHeight + 20}px`);
                        }}
                    />

                    <button onClick={handleSendMessage} className="chat-send-button" disabled={!newMessage.trim()}></button>
                </div>
            </div>
        </div>
    );
};

export default ChatPage;
