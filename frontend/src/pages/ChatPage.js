import { io } from 'socket.io-client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import '../styles/ChatPage.css';
import { useUser } from '../utils/userContext';

const apiUrl = process.env.REACT_APP_API_URL;

const ChatPage = () => {
    const { orderId } = useParams();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { currentUser } = useUser();
    const [selectedUser, setSelectedUser] = useState(null);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const textareaRef = useRef(null);
    const socket = useRef(null);

    useEffect(() => {

        socket.current = io(process.env.REACT_APP_SOCKET_URL, {
            transports: ['websocket'],
            withCredentials: true
        });

        if (currentUser) {
            socket.current.emit('joinChat', { userId: currentUser.id });

            socket.current.on('receiveMessage', (message) => {
                if (String(message.orderId) === String(orderId)) { // Приводим оба к строке
                    setMessages((prev) => [...prev, message]);
                }
            });

        }

        return () => {
            socket.current.disconnect();
        };
    }, [currentUser, orderId]);

    const scrollToBottom = () => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    };


    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                const { data: order } = await axios.get(`${apiUrl}/api/orders/${orderId}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
                });

                const userId = order.creatorId === currentUser.id ? order.executorId : order.creatorId;
                const { data: user } = await axios.get(`${apiUrl}/api/auth/${userId}`);
                setSelectedUser(user);

                const { data: messagesData } = await axios.get(`${apiUrl}/api/messages/${orderId}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
                });
                setMessages(messagesData);
            } catch (err) {
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
                orderId,
            };

            const { data } = await axios.post(`${apiUrl}/api/messages`, messageData, {
                headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            });

            socket.current.emit('sendMessage', data);
            setMessages((prev) => [...prev, data]);
            setNewMessage('');
            textareaRef.current.style.height = '40px';
        } catch (err) {
            setError('Не удалось отправить сообщение.');
        }
    }, [newMessage, orderId, currentUser, selectedUser]);

    // Обработчик изменения текста с автоувеличением высоты
    const handleInputChange = (e) => {
        const textarea = textareaRef.current;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
        setNewMessage(e.target.value);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // Авто-прокрутка вверх при изменении высоты поля ввода
    useEffect(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [newMessage]);

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

                {/* Контейнер с сообщениями */}
                <div className="chat-messages" ref={messagesContainerRef}>
                    {messages.length > 0 ? (
                        messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`chat-message ${
                                    msg.senderId === currentUser.id ? 'chat-message-sent' : 'chat-message-received'
                                }`}
                            >
                                <p>{msg.content}</p>
                            </div>
                        ))
                    ) : (
                        <div className="chat-empty">Нет сообщений</div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Поле ввода */}
                <div className="chat-input-container">
                    <textarea
                        ref={textareaRef}
                        value={newMessage}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Введите сообщение..."
                        className="chat-input"
                        rows="1"
                        style={{ minHeight: '40px', maxHeight: '120px', overflowY: 'hidden' }}
                    />

                    <button onClick={handleSendMessage} className="chat-send-button" disabled={!newMessage.trim()}></button>
                </div>
            </div>
        </div>
    );
};

export default ChatPage;
