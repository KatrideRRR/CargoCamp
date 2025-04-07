import React, { useEffect, useState } from "react";
import axios from "axios";
import "../styles/UsersPage.css"; // Импорт стилей
import { useNavigate } from "react-router-dom";

const apiUrl = process.env.REACT_APP_API_URL;

function UsersPage() {
    const [users, setUsers] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filteredUsers, setFilteredUsers] = useState([]);
    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();
    const [documentsCount, setDocumentsCount] = useState({});
    const [complaintsCount, setComplaintsCount] = useState({});
    const [ordersCount, setOrdersCount] = useState({});

    useEffect(() => {
        axios.get(`${apiUrl}/api/admin/users`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((response) => {
                setUsers(response.data);
                setFilteredUsers(response.data);
            })
            .catch((error) => console.error("Ошибка загрузки пользователей", error));
    }, [token]);
    // Запрос количества документов, жалоб и заказов
    useEffect(() => {
        const fetchUserData = async () => {
            const docCounts = {};
            const complaintCounts = {};
            const orderCounts = {};

            for (const user of users) {
                try {
                    // Документы
                    const docResponse = await axios.get(`${apiUrl}/api/admin/user-documents/${user.id}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    docCounts[user.id] = docResponse.data.documents.length;
                } catch (error) {
                    console.error(`Ошибка загрузки документов пользователя ${user.id}`, error);
                    docCounts[user.id] = 0;
                }

                try {
                    // Жалобы
                    const complaintResponse = await axios.get(`${apiUrl}/api/admin/users/${user.id}/complaints`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    complaintCounts[user.id] = complaintResponse.data.complaints.length;
                } catch (error) {
                    console.error(`Ошибка загрузки жалоб пользователя ${user.id}`, error);
                    complaintCounts[user.id] = 0;
                }

                try {
                    // Заказы
                    const orderResponse = await axios.get(`${apiUrl}/api/admin/users/${user.id}/orders`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    orderCounts[user.id] = orderResponse.data.orders.length;
                } catch (error) {
                    console.error(`Ошибка загрузки заказов пользователя ${user.id}`, error);
                    orderCounts[user.id] = 0;
                }
            }

            setDocumentsCount(docCounts);
            setComplaintsCount(complaintCounts);
            setOrdersCount(orderCounts);
        };

        if (users.length > 0) {
            fetchUserData();
        }
    }, [users, token]);


    // Функция блокировки пользователя
    const blockUser = async (id) => {
        try {
            await axios.put(`${apiUrl}/api/admin/users/${id}/block`, {}, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setUsers(users.map(user => user.id === id ? { ...user, role: "banned" } : user));
            setFilteredUsers(filteredUsers.map(user => user.id === id ? { ...user, role: "banned" } : user));
        } catch (error) {
            console.error("Ошибка блокировки", error);
        }
    };

    // Функция разблокировки пользователя
    const unblockUser = async (id) => {
        try {
            await axios.put(`${apiUrl}/api/admin/users/${id}/unblock`, {}, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setUsers(users.map(user => user.id === id ? { ...user, role: "user" } : user));
            setFilteredUsers(filteredUsers.map(user => user.id === id ? { ...user, role: "user" } : user));
        } catch (error) {
            console.error("Ошибка разблокировки", error);
        }
    };

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredUsers(users);
        } else {
            setFilteredUsers(users.filter(user =>
                user.id.toString().includes(query) || user.phone.includes(query)
            ));
        }
    };
    // Функция для обновления статуса верификации
    const toggleVerification = async (id, currentStatus) => {
        try {
            const newStatus = !currentStatus; // Меняем на противоположное значение
            await axios.put(`${apiUrl}/api/admin/users/${id}/verify`, { isVerified: newStatus }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setUsers(users.map(user => user.id === id ? { ...user, isVerified: newStatus } : user));
            setFilteredUsers(filteredUsers.map(user => user.id === id ? { ...user, isVerified: newStatus } : user));
        } catch (error) {
            console.error("Ошибка обновления верификации", error);
        }
    };

    const handleComplaints = (id) => navigate(`/users/${id}/complaints`);
    const handleOrders = (id) => navigate(`/users/${id}/orders`);
    const handlePhotos = (id) => navigate(`/user-documents/${id}`);
    const handleClick = () => {navigate("/create-user");};

    return (
        <div className="users-container">
            <h1>Пользователи</h1>

            <input
                type="text"
                className="search-input"
                placeholder="Поиск по ID или номеру телефона"
                value={searchQuery}
                onChange={handleSearch}
            />
            <button onClick={handleClick} className="create-user-button">
                Создать пользователя
            </button>


            <table className="users-table">
                <thead>
                <tr>
                    <th>ID</th>
                    <th>Имя</th>
                    <th>Телефон</th>
                    <th>Дата регистрации</th>
                    <th>Рейтинг</th>
                    <th>Верифицирован</th>
                    <th>Действия</th>
                </tr>
                </thead>
                <tbody>
                {filteredUsers.map((user) => (
                    <tr key={user.id}>
                        <td>{user.id}</td>
                        <td>{user.username}</td>
                        <td>{user.phone}</td>
                        <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td>{user.rating ? user.rating.toFixed(1) : "—"}</td>
                        <td>
                            <button
                                className={`verify-button ${user.isVerified ? 'verified' : 'not-verified'}`}
                                onClick={() => toggleVerification(user.id, user.isVerified)}
                            >
                                {user.isVerified ? 'Верифицирован' : 'Не верифицирован'}
                            </button>
                        </td>

                        <td>
                            <div className="action-buttons">
                                <button
                                    className="complaints-button"
                                    onClick={() => handleComplaints(user.id)}
                                    disabled={!complaintsCount[user.id]}
                                    style={{backgroundColor: !complaintsCount[user.id] ? "gray" : "blue"}}
                                >
                                    Жалобы ({complaintsCount[user.id] || 0})
                                </button>

                                <button
                                    className="orders-button"
                                    onClick={() => handleOrders(user.id)}
                                    style={{backgroundColor: !ordersCount[user.id] ? "green" : "blue"}}
                                >
                                    Заказы ({ordersCount[user.id] || 0})
                                </button>

                                <button
                                    className="photos-button"
                                    onClick={() => handlePhotos(user.id)}
                                    disabled={!documentsCount[user.id]}
                                    style={{backgroundColor: !documentsCount[user.id] ? "gray" : "blue"}}
                                >
                                    Фото ({documentsCount[user.id] || 0})
                                </button>


                                {user.role === "banned" ? (
                                    <button className="unblock-button"
                                            onClick={() => unblockUser(user.id)}>Разблокировать</button>
                                ) : (
                                    <button className="block-button"
                                            onClick={() => blockUser(user.id)}>Заблокировать</button>
                                )}
                            </div>
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}

export default UsersPage;
