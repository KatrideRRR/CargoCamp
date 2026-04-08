import React, { useEffect, useState } from "react";
import axios from "axios";
import "../styles/UsersPage.css";
import { useNavigate } from "react-router-dom";

const apiUrl = process.env.REACT_APP_API_URL;

function UsersPage() {
    const [users, setUsers] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [documentsCount, setDocumentsCount] = useState({});
    const [complaintsCount, setComplaintsCount] = useState({});
    const [ordersCount, setOrdersCount] = useState({});

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/admin/users`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                setUsers(response.data);
                setFilteredUsers(response.data);
            })
            .catch((error) => console.error("Ошибка загрузки пользователей", error));
    }, [token]);

    useEffect(() => {
        const fetchUserData = async () => {
            const docCounts = {};
            const complaintCountsData = {};
            const orderCountsData = {};

            for (const user of users) {
                try {
                    const docResponse = await axios.get(
                        `${apiUrl}/api/admin/user-documents/${user.id}`,
                        {
                            headers: { Authorization: `Bearer ${token}` },
                        }
                    );
                    docCounts[user.id] = docResponse.data.documents.length;
                } catch (error) {
                    console.error(`Ошибка загрузки документов пользователя ${user.id}`, error);
                    docCounts[user.id] = 0;
                }

                try {
                    const complaintResponse = await axios.get(
                        `${apiUrl}/api/admin/users/${user.id}/complaints`,
                        {
                            headers: { Authorization: `Bearer ${token}` },
                        }
                    );
                    complaintCountsData[user.id] = complaintResponse.data.complaints.length;
                } catch (error) {
                    console.error(`Ошибка загрузки жалоб пользователя ${user.id}`, error);
                    complaintCountsData[user.id] = 0;
                }

                try {
                    const orderResponse = await axios.get(
                        `${apiUrl}/api/admin/users/${user.id}/orders`,
                        {
                            headers: { Authorization: `Bearer ${token}` },
                        }
                    );
                    orderCountsData[user.id] = orderResponse.data.orders.length;
                } catch (error) {
                    console.error(`Ошибка загрузки заказов пользователя ${user.id}`, error);
                    orderCountsData[user.id] = 0;
                }
            }

            setDocumentsCount(docCounts);
            setComplaintsCount(complaintCountsData);
            setOrdersCount(orderCountsData);
        };

        if (users.length > 0) {
            fetchUserData();
        }
    }, [users, token]);

    const blockUser = async (id) => {
        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/block`,
                {},
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            setUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, role: "banned" } : user
                )
            );

            setFilteredUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, role: "banned" } : user
                )
            );
        } catch (error) {
            console.error("Ошибка блокировки", error);
        }
    };

    const unblockUser = async (id) => {
        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/unblock`,
                {},
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            setUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, role: "user" } : user
                )
            );

            setFilteredUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, role: "user" } : user
                )
            );
        } catch (error) {
            console.error("Ошибка разблокировки", error);
        }
    };

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredUsers(users);
            return;
        }

        setFilteredUsers(
            users.filter(
                (user) =>
                    user.id.toString().includes(query) ||
                    user.phone.includes(query)
            )
        );
    };

    const toggleVerification = async (id, currentStatus) => {
        const statusOptions = ["unverified", "pensioner", "verified"];
        const currentIndex = statusOptions.indexOf(currentStatus);
        const nextStatus = statusOptions[(currentIndex + 1) % statusOptions.length];

        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/verify`,
                { userStatus: nextStatus },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            setUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, userStatus: nextStatus } : user
                )
            );

            setFilteredUsers((prev) =>
                prev.map((user) =>
                    user.id === id ? { ...user, userStatus: nextStatus } : user
                )
            );
        } catch (error) {
            console.error("Ошибка обновления верификации", error);
        }
    };

    const handleComplaints = (id) => navigate(`/users/${id}/complaints`);
    const handleOrders = (id) => navigate(`/users/${id}/orders`);
    const handlePhotos = (id) => navigate(`/user-documents/${id}`);
    const handleCreateUser = () => navigate("/create-user");

    return (
        <div className="users-container">
            <h1>Пользователи</h1>

            <div className="users-toolbar">
                <input
                    type="text"
                    className="search-input"
                    placeholder="Поиск по ID или номеру телефона"
                    value={searchQuery}
                    onChange={handleSearch}
                />

                <button onClick={handleCreateUser} className="create-user-button">
                    Создать пользователя
                </button>
            </div>

            <div className="users-table-wrapper">
                <table className="users-table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Имя</th>
                        <th>Телефон</th>
                        <th>Дата регистрации</th>
                        <th>Рейтинг</th>
                        <th>Верификация</th>
                        <th>Действия</th>
                    </tr>
                    </thead>

                    <tbody>
                    {filteredUsers.map((user) => {
                        const hasComplaints = Boolean(complaintsCount[user.id]);
                        const hasDocuments = Boolean(documentsCount[user.id]);
                        const hasOrders = Boolean(ordersCount[user.id]);

                        return (
                            <tr key={user.id}>
                                <td>{user.id}</td>
                                <td>{user.username}</td>
                                <td>{user.phone}</td>
                                <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                                <td>{user.rating ? user.rating.toFixed(1) : "—"}</td>

                                <td>
                                    <button
                                        className={`verify-button ${
                                            user.userStatus === "verified"
                                                ? "verified"
                                                : user.userStatus === "pensioner"
                                                    ? "pensioner"
                                                    : "unverified"
                                        }`}
                                        onClick={() =>
                                            toggleVerification(user.id, user.userStatus)
                                        }
                                    >
                                        {user.userStatus === "verified"
                                            ? "Верифицирован"
                                            : user.userStatus === "pensioner"
                                                ? "Пенсионер"
                                                : "Не верифицирован"}
                                    </button>
                                </td>

                                <td>
                                    <div className="action-buttons">
                                        <button
                                            className={`complaints-button ${
                                                !hasComplaints ? "disabled-button" : ""
                                            }`}
                                            onClick={() => handleComplaints(user.id)}
                                            disabled={!hasComplaints}
                                        >
                                            Жалобы · {complaintsCount[user.id] || 0}
                                        </button>

                                        <button
                                            className={`orders-button ${
                                                !hasOrders ? "empty-button" : ""
                                            }`}
                                            onClick={() => handleOrders(user.id)}
                                        >
                                            Заказы · {ordersCount[user.id] || 0}
                                        </button>

                                        <button
                                            className={`photos-button ${
                                                !hasDocuments ? "disabled-button" : ""
                                            }`}
                                            onClick={() => handlePhotos(user.id)}
                                            disabled={!hasDocuments}
                                        >
                                            Фото · {documentsCount[user.id] || 0}
                                        </button>

                                        {user.role === "banned" ? (
                                            <button
                                                className="unblock-button"
                                                onClick={() => unblockUser(user.id)}
                                            >
                                                Разблок.
                                            </button>
                                        ) : (
                                            <button
                                                className="block-button"
                                                onClick={() => blockUser(user.id)}
                                            >
                                                Блок
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default UsersPage;