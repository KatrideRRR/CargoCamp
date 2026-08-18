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
    const [actionLoading, setActionLoading] = useState({});

    const [
        vehicleRejectUser,
        setVehicleRejectUser,
    ] = useState(null);

    const [
        vehicleRejectReason,
        setVehicleRejectReason,
    ] = useState("");

    const [
        vehicleActionLoading,
        setVehicleActionLoading,
    ] = useState({});

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    const approveVehicle = async (user) => {
        if (!user?.id) return;

        const vehicleName = [
            user.vehicleBrand,
            user.vehicleModel,
        ]
            .filter(Boolean)
            .join(" ");

        const ok = window.confirm(
            `Подтвердить автомобиль ${vehicleName || ""} ${
                user.vehiclePlate || ""
            }?`
        );

        if (!ok) {
            return;
        }

        try {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: true,
            }));

            const res = await axios.put(
                `${apiUrl}/api/admin/users/${user.id}/vehicle-verification`,
                {
                    status: "verified",
                },
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },
                }
            );

            const updated =
                res.data?.user || {};

            updateUserLocally(
                user.id,
                {
                    vehicleVerificationStatus:
                        updated.vehicleVerificationStatus ||
                        "verified",

                    vehicleVerificationNote:
                        updated.vehicleVerificationNote ??
                        null,
                }
            );
        } catch (error) {
            console.error(
                "Ошибка подтверждения автомобиля:",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось подтвердить автомобиль"
            );
        } finally {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: false,
            }));
        }
    };

    const openVehicleReject = (user) => {
        setVehicleRejectUser(user);
        setVehicleRejectReason("");
    };

    const closeVehicleReject = () => {
        setVehicleRejectUser(null);
        setVehicleRejectReason("");
    };

    const rejectVehicle = async () => {
        const user =
            vehicleRejectUser;

        if (!user?.id) {
            return;
        }

        const reason =
            vehicleRejectReason.trim();

        if (reason.length < 3) {
            alert(
                "Укажите причину отклонения"
            );
            return;
        }

        try {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: true,
            }));

            const res = await axios.put(
                `${apiUrl}/api/admin/users/${user.id}/vehicle-verification`,
                {
                    status: "rejected",
                    note: reason,
                },
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },
                }
            );

            const updated =
                res.data?.user || {};

            updateUserLocally(
                user.id,
                {
                    vehicleVerificationStatus:
                        updated.vehicleVerificationStatus ||
                        "rejected",

                    vehicleVerificationNote:
                        updated.vehicleVerificationNote ||
                        reason,
                }
            );

            closeVehicleReject();
        } catch (error) {
            console.error(
                "Ошибка отклонения автомобиля:",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось отклонить автомобиль"
            );
        } finally {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: false,
            }));
        }
    };

    const removeVehicle = async (user) => {
        if (!user?.id) {
            return;
        }

        const vehicleName = [
            user.vehicleBrand,
            user.vehicleModel,
        ]
            .filter(Boolean)
            .join(" ");

        const ok = window.confirm(
            `Удалить автомобиль ${
                vehicleName || ""
            } ${
                user.vehiclePlate || ""
            } у пользователя ${
                user.username || user.phone || user.id
            }?`
        );

        if (!ok) {
            return;
        }

        try {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: true,
            }));

            await axios.delete(
                `${apiUrl}/api/admin/users/${user.id}/vehicle`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(
                user.id,
                {
                    vehicleBrand: null,
                    vehicleModel: null,
                    vehicleColor: null,
                    vehiclePlate: null,
                    vehicleYear: null,
                    vehiclePhoto: null,

                    vehicleVerificationStatus:
                        "none",

                    vehicleVerificationNote:
                        null,
                }
            );
        } catch (error) {
            console.error(
                "Ошибка удаления автомобиля:",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось удалить автомобиль"
            );
        } finally {
            setVehicleActionLoading((prev) => ({
                ...prev,
                [user.id]: false,
            }));
        }
    };

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/admin/users`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
            .then((response) => {
                setUsers(response.data);
                setFilteredUsers(response.data);
            })
            .catch((error) => {
                console.error(
                    "Ошибка загрузки пользователей",
                    error
                );
            });
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
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    docCounts[user.id] =
                        docResponse.data.documents.length;
                } catch (error) {
                    console.error(
                        `Ошибка загрузки документов пользователя ${user.id}`,
                        error
                    );

                    docCounts[user.id] = 0;
                }

                try {
                    const complaintResponse = await axios.get(
                        `${apiUrl}/api/admin/users/${user.id}/complaints`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    complaintCountsData[user.id] =
                        complaintResponse.data.complaints.length;
                } catch (error) {
                    console.error(
                        `Ошибка загрузки жалоб пользователя ${user.id}`,
                        error
                    );

                    complaintCountsData[user.id] = 0;
                }

                try {
                    const orderResponse = await axios.get(
                        `${apiUrl}/api/admin/users/${user.id}/orders`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    orderCountsData[user.id] =
                        orderResponse.data.orders.length;
                } catch (error) {
                    console.error(
                        `Ошибка загрузки заказов пользователя ${user.id}`,
                        error
                    );

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

    const updateUserLocally = (id, changes) => {
        setUsers((prev) =>
            prev.map((user) =>
                user.id === id
                    ? {
                        ...user,
                        ...changes,
                    }
                    : user
            )
        );

        setFilteredUsers((prev) =>
            prev.map((user) =>
                user.id === id
                    ? {
                        ...user,
                        ...changes,
                    }
                    : user
            )
        );
    };

    const setLoading = (id, action, value) => {
        const key = `${id}_${action}`;

        setActionLoading((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const blockUser = async (id) => {
        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/block`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(id, {
                role: "banned",
            });
        } catch (error) {
            console.error("Ошибка блокировки", error);
            alert(
                error.response?.data?.message ||
                "Не удалось заблокировать пользователя"
            );
        }
    };

    const unblockUser = async (id) => {
        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/unblock`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(id, {
                role: "user",
            });
        } catch (error) {
            console.error("Ошибка разблокировки", error);
            alert(
                error.response?.data?.message ||
                "Не удалось разблокировать пользователя"
            );
        }
    };

    const toggleAdmin = async (user) => {
        if (user.role === "banned") {
            alert(
                "Сначала разблокируйте пользователя."
            );
            return;
        }

        const nextRole =
            user.role === "admin"
                ? "user"
                : "admin";

        const message =
            nextRole === "admin"
                ? `Дать пользователю ${user.username || user.phone} права администратора?`
                : `Забрать права администратора у ${user.username || user.phone}?`;

        if (!window.confirm(message)) {
            return;
        }

        setLoading(user.id, "role", true);

        try {
            const response = await axios.put(
                `${apiUrl}/api/admin/users/${user.id}/role`,
                {
                    role: nextRole,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(user.id, {
                role:
                    response.data.user?.role ||
                    nextRole,
            });
        } catch (error) {
            console.error(
                "Ошибка изменения роли",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось изменить роль пользователя"
            );
        } finally {
            setLoading(user.id, "role", false);
        }
    };

    const givePremium = async (user, days) => {
        const message =
            days === 7
                ? `Выдать пользователю ${user.username || user.phone} премиум на 7 дней?`
                : `Выдать пользователю ${user.username || user.phone} премиум на 30 дней?`;

        if (!window.confirm(message)) {
            return;
        }

        setLoading(user.id, "premium", true);

        try {
            const response = await axios.put(
                `${apiUrl}/api/admin/users/${user.id}/premium`,
                {
                    days,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(user.id, {
                subscription_type:
                    response.data.user
                        ?.subscription_type ||
                    "premium",

                subscription_expires_at:
                response.data.user
                    ?.subscription_expires_at,
            });
        } catch (error) {
            console.error(
                "Ошибка выдачи премиума",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось выдать премиум"
            );
        } finally {
            setLoading(
                user.id,
                "premium",
                false
            );
        }
    };

    const removePremium = async (user) => {
        if (
            !window.confirm(
                `Снять премиум у пользователя ${user.username || user.phone}?`
            )
        ) {
            return;
        }

        setLoading(user.id, "premium", true);

        try {
            await axios.delete(
                `${apiUrl}/api/admin/users/${user.id}/premium`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(user.id, {
                subscription_type: "standard",
                subscription_expires_at: null,
            });
        } catch (error) {
            console.error(
                "Ошибка снятия премиума",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось снять премиум"
            );
        } finally {
            setLoading(
                user.id,
                "premium",
                false
            );
        }
    };

    const handleSearch = (e) => {
        const query =
            e.target.value.toLowerCase();

        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredUsers(users);
            return;
        }

        setFilteredUsers(
            users.filter((user) => {
                const id =
                    String(user.id || "")
                        .toLowerCase();

                const phone =
                    String(user.phone || "")
                        .toLowerCase();

                const username =
                    String(user.username || "")
                        .toLowerCase();

                return (
                    id.includes(query) ||
                    phone.includes(query) ||
                    username.includes(query)
                );
            })
        );
    };

    const toggleVerification = async (
        id,
        currentStatus
    ) => {
        const statusOptions = [
            "unverified",
            "pensioner",
            "verified",
        ];

        const currentIndex =
            statusOptions.indexOf(
                currentStatus
            );

        const nextStatus =
            statusOptions[
            (currentIndex + 1) %
            statusOptions.length
                ];

        try {
            await axios.put(
                `${apiUrl}/api/admin/users/${id}/verify`,
                {
                    userStatus: nextStatus,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            updateUserLocally(id, {
                userStatus: nextStatus,
            });
        } catch (error) {
            console.error(
                "Ошибка обновления верификации",
                error
            );
        }
    };

    const isPremiumActive = (user) => {
        if (
            user.subscription_type !==
            "premium"
        ) {
            return false;
        }

        if (
            !user.subscription_expires_at
        ) {
            return true;
        }

        return (
            new Date(
                user.subscription_expires_at
            ).getTime() > Date.now()
        );
    };

    const formatPremiumDate = (value) => {
        if (!value) {
            return "без срока";
        }

        const date = new Date(value);

        if (
            Number.isNaN(date.getTime())
        ) {
            return "—";
        }

        return date.toLocaleDateString(
            "ru-RU"
        );
    };

    const handleComplaints = (id) =>
        navigate(
            `/users/${id}/complaints`
        );

    const handleOrders = (id) =>
        navigate(
            `/users/${id}/orders`
        );

    const handlePhotos = (id) =>
        navigate(
            `/user-documents/${id}`
        );

    const handleCreateUser = () =>
        navigate("/create-user");

    return (
        <div className="users-container">
            <h1>Пользователи</h1>

            <div className="users-toolbar">
                <input
                    type="text"
                    className="search-input"
                    placeholder="Поиск по ID, имени или телефону"
                    value={searchQuery}
                    onChange={handleSearch}
                />

                <button
                    onClick={handleCreateUser}
                    className="create-user-button"
                >
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
                        <th>Роль</th>
                        <th>Премиум</th>
                        <th>Автомобиль</th>
                        <th>Действия</th>
                    </tr>
                    </thead>

                    <tbody>
                    {filteredUsers.map(
                        (user) => {
                            const hasComplaints =
                                Boolean(
                                    complaintsCount[
                                        user.id
                                        ]
                                );

                            const hasDocuments =
                                Boolean(
                                    documentsCount[
                                        user.id
                                        ]
                                );

                            const hasOrders =
                                Boolean(
                                    ordersCount[
                                        user.id
                                        ]
                                );

                            const premiumActive =
                                isPremiumActive(
                                    user
                                );

                            const roleLoading =
                                Boolean(
                                    actionLoading[
                                        `${user.id}_role`
                                        ]
                                );

                            const premiumLoading =
                                Boolean(
                                    actionLoading[
                                        `${user.id}_premium`
                                        ]
                                );

                            return (
                                <tr key={user.id}>
                                    <td>
                                        {user.id}
                                    </td>

                                    <td>
                                        {user.username}
                                    </td>

                                    <td>
                                        {user.phone}
                                    </td>

                                    <td>
                                        {new Date(
                                            user.createdAt
                                        ).toLocaleDateString(
                                            "ru-RU"
                                        )}
                                    </td>

                                    <td>
                                        {user.rating
                                            ? Number(
                                                user.rating
                                            ).toFixed(
                                                1
                                            )
                                            : "—"}
                                    </td>

                                    <td>
                                        <button
                                            className={`verify-button ${
                                                user.userStatus ===
                                                "verified"
                                                    ? "verified"
                                                    : user.userStatus ===
                                                    "pensioner"
                                                        ? "pensioner"
                                                        : "unverified"
                                            }`}
                                            onClick={() =>
                                                toggleVerification(
                                                    user.id,
                                                    user.userStatus
                                                )
                                            }
                                        >
                                            {user.userStatus ===
                                            "verified"
                                                ? "Верифицирован"
                                                : user.userStatus ===
                                                "pensioner"
                                                    ? "Пенсионер"
                                                    : "Не верифицирован"}
                                        </button>
                                    </td>

                                    <td>
                                        {user.role ===
                                        "banned" ? (
                                            <div className="admin-role-cell">
                                                <span className="role-badge role-banned">
                                                    Заблокирован
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="admin-role-cell">
                                                <span
                                                    className={`role-badge ${
                                                        user.role ===
                                                        "admin"
                                                            ? "role-admin"
                                                            : "role-user"
                                                    }`}
                                                >
                                                    {user.role ===
                                                    "admin"
                                                        ? "Администратор"
                                                        : "Пользователь"}
                                                </span>

                                                <button
                                                    className={
                                                        user.role ===
                                                        "admin"
                                                            ? "remove-admin-button"
                                                            : "make-admin-button"
                                                    }
                                                    disabled={
                                                        roleLoading
                                                    }
                                                    onClick={() =>
                                                        toggleAdmin(
                                                            user
                                                        )
                                                    }
                                                >
                                                    {roleLoading
                                                        ? "..."
                                                        : user.role ===
                                                        "admin"
                                                            ? "Забрать"
                                                            : "Дать админку"}
                                                </button>
                                            </div>
                                        )}
                                    </td>

                                    <td>
                                        <div className="premium-admin-cell">
                                            {premiumActive ? (
                                                <>
                                                    <span className="premium-badge">
                                                        PREMIUM
                                                    </span>

                                                    <span className="premium-expire">
                                                        до{" "}
                                                        {formatPremiumDate(
                                                            user.subscription_expires_at
                                                        )}
                                                    </span>

                                                    <div className="premium-admin-buttons">
                                                        <button
                                                            disabled={
                                                                premiumLoading
                                                            }
                                                            onClick={() =>
                                                                givePremium(
                                                                    user,
                                                                    7
                                                                )
                                                            }
                                                        >
                                                            +7
                                                        </button>

                                                        <button
                                                            disabled={
                                                                premiumLoading
                                                            }
                                                            onClick={() =>
                                                                givePremium(
                                                                    user,
                                                                    30
                                                                )
                                                            }
                                                        >
                                                            +30
                                                        </button>

                                                        <button
                                                            className="remove-premium-button"
                                                            disabled={
                                                                premiumLoading
                                                            }
                                                            onClick={() =>
                                                                removePremium(
                                                                    user
                                                                )
                                                            }
                                                        >
                                                            Снять
                                                        </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="no-premium-badge">
                                                        Нет
                                                    </span>

                                                    <div className="premium-admin-buttons">
                                                        <button
                                                            disabled={
                                                                premiumLoading
                                                            }
                                                            onClick={() =>
                                                                givePremium(
                                                                    user,
                                                                    7
                                                                )
                                                            }
                                                        >
                                                            7 дней
                                                        </button>

                                                        <button
                                                            disabled={
                                                                premiumLoading
                                                            }
                                                            onClick={() =>
                                                                givePremium(
                                                                    user,
                                                                    30
                                                                )
                                                            }
                                                        >
                                                            30 дней
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </td>

                                    <td>
                                        <div className="admin-vehicle-cell">
                                            {user.vehicleBrand ||
                                            user.vehicleModel ||
                                            user.vehiclePlate ? (
                                                <>
                                                    <div className="admin-vehicle-name">
                                                        {[
                                                            user.vehicleBrand,
                                                            user.vehicleModel,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(" ")}
                                                    </div>

                                                    <div className="admin-vehicle-meta">
                                                        {user.vehicleColor && (
                                                            <span>
                            {user.vehicleColor}
                        </span>
                                                        )}

                                                        {user.vehicleYear && (
                                                            <span>
                            {user.vehicleYear} г.
                        </span>
                                                        )}
                                                    </div>

                                                    {user.vehiclePlate && (
                                                        <div className="admin-vehicle-plate">
                                                            {user.vehiclePlate}
                                                        </div>
                                                    )}

                                                    <div
                                                        className={`admin-vehicle-status admin-vehicle-status-${
                                                            user.vehicleVerificationStatus ||
                                                            "none"
                                                        }`}
                                                    >
                                                        {user.vehicleVerificationStatus ===
                                                        "verified"
                                                            ? "Подтверждён"
                                                            : user.vehicleVerificationStatus ===
                                                            "pending"
                                                                ? "Ожидает проверки"
                                                                : user.vehicleVerificationStatus ===
                                                                "rejected"
                                                                    ? "Отклонён"
                                                                    : "Не проверен"}
                                                    </div>

                                                    {user.vehicleVerificationStatus ===
                                                        "rejected" &&
                                                        user.vehicleVerificationNote && (
                                                            <div className="admin-vehicle-reject-note">
                                                                {user.vehicleVerificationNote}
                                                            </div>
                                                        )}

                                                    {user.vehiclePhoto && (
                                                        <a
                                                            className="admin-vehicle-photo-link"
                                                            href={
                                                                user.vehiclePhoto.startsWith(
                                                                    "http"
                                                                )
                                                                    ? user.vehiclePhoto
                                                                    : `${apiUrl}${user.vehiclePhoto}`
                                                            }
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                        >
                                                            Фото автомобиля
                                                        </a>
                                                    )}

                                                    <div className="admin-vehicle-actions">
                                                        {user.vehicleVerificationStatus ===
                                                            "pending" && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        className="admin-vehicle-approve"
                                                                        disabled={
                                                                            Boolean(
                                                                                vehicleActionLoading[
                                                                                    user.id
                                                                                    ]
                                                                            )
                                                                        }
                                                                        onClick={() =>
                                                                            approveVehicle(user)
                                                                        }
                                                                    >
                                                                        Одобрить
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        className="admin-vehicle-reject"
                                                                        disabled={
                                                                            Boolean(
                                                                                vehicleActionLoading[
                                                                                    user.id
                                                                                    ]
                                                                            )
                                                                        }
                                                                        onClick={() =>
                                                                            openVehicleReject(user)
                                                                        }
                                                                    >
                                                                        Отклонить
                                                                    </button>
                                                                </>
                                                            )}

                                                        {user.vehicleVerificationStatus ===
                                                            "rejected" && (
                                                                <button
                                                                    type="button"
                                                                    className="admin-vehicle-approve"
                                                                    disabled={
                                                                        Boolean(
                                                                            vehicleActionLoading[
                                                                                user.id
                                                                                ]
                                                                        )
                                                                    }
                                                                    onClick={() =>
                                                                        approveVehicle(user)
                                                                    }
                                                                >
                                                                    Одобрить
                                                                </button>
                                                            )}

                                                        <button
                                                            type="button"
                                                            className="admin-vehicle-remove"
                                                            disabled={
                                                                Boolean(
                                                                    vehicleActionLoading[
                                                                        user.id
                                                                        ]
                                                                )
                                                            }
                                                            onClick={() =>
                                                                removeVehicle(user)
                                                            }
                                                        >
                                                            Удалить автомобиль
                                                        </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <span className="admin-vehicle-empty">
                Не указан
            </span>
                                            )}
                                        </div>
                                    </td>

                                    <td>
                                        <div className="action-buttons">
                                            <button
                                                className={`complaints-button ${
                                                    !hasComplaints
                                                        ? "disabled-button"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    handleComplaints(
                                                        user.id
                                                    )
                                                }
                                                disabled={
                                                    !hasComplaints
                                                }
                                            >
                                                Жалобы ·{" "}
                                                {complaintsCount[
                                                    user.id
                                                    ] || 0}
                                            </button>

                                            <button
                                                className={`orders-button ${
                                                    !hasOrders
                                                        ? "empty-button"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    handleOrders(
                                                        user.id
                                                    )
                                                }
                                            >
                                                Заказы ·{" "}
                                                {ordersCount[
                                                    user.id
                                                    ] || 0}
                                            </button>

                                            <button
                                                className={`photos-button ${
                                                    !hasDocuments
                                                        ? "disabled-button"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    handlePhotos(
                                                        user.id
                                                    )
                                                }
                                                disabled={
                                                    !hasDocuments
                                                }
                                            >
                                                Фото ·{" "}
                                                {documentsCount[
                                                    user.id
                                                    ] || 0}
                                            </button>

                                            {user.role ===
                                            "banned" ? (
                                                <button
                                                    className="unblock-button"
                                                    onClick={() =>
                                                        unblockUser(
                                                            user.id
                                                        )
                                                    }
                                                >
                                                    Разблок.
                                                </button>
                                            ) : (
                                                <button
                                                    className="block-button"
                                                    onClick={() =>
                                                        blockUser(
                                                            user.id
                                                        )
                                                    }
                                                >
                                                    Блок
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        }
                    )}
                    </tbody>
                </table>
            </div>
            {vehicleRejectUser && (
                <div
                    className="admin-vehicle-modal-overlay"
                    onClick={closeVehicleReject}
                >
                    <div
                        className="admin-vehicle-modal"
                        onClick={(e) =>
                            e.stopPropagation()
                        }
                    >
                        <h3>
                            Отклонить автомобиль
                        </h3>

                        <p>
                            {[
                                vehicleRejectUser.vehicleBrand,
                                vehicleRejectUser.vehicleModel,
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            {vehicleRejectUser.vehiclePlate
                                ? ` · ${vehicleRejectUser.vehiclePlate}`
                                : ""}
                        </p>

                        <label className="admin-vehicle-reason-label">
                            Причина отказа

                            <textarea
                                value={
                                    vehicleRejectReason
                                }
                                onChange={(e) =>
                                    setVehicleRejectReason(
                                        e.target.value.slice(
                                            0,
                                            500
                                        )
                                    )
                                }
                                placeholder="Например: госномер не соответствует фотографии или фото автомобиля нечёткое"
                                rows={5}
                                maxLength={500}
                            />
                        </label>

                        <div className="admin-vehicle-reason-count">
                            {vehicleRejectReason.length} / 500
                        </div>

                        <div className="admin-vehicle-modal-actions">
                            <button
                                type="button"
                                onClick={
                                    closeVehicleReject
                                }
                                className="admin-vehicle-modal-cancel"
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                onClick={rejectVehicle}
                                className="admin-vehicle-modal-reject"
                                disabled={
                                    vehicleRejectReason.trim()
                                        .length < 3 ||
                                    Boolean(
                                        vehicleActionLoading[
                                            vehicleRejectUser.id
                                            ]
                                    )
                                }
                            >
                                {vehicleActionLoading[
                                    vehicleRejectUser.id
                                    ]
                                    ? "Сохраняем..."
                                    : "Отклонить"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UsersPage;