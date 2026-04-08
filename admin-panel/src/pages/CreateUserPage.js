import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "../styles/CreateUserPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function CreateUserPage() {
    const [username, setUsername] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const navigate = useNavigate();
    const token = localStorage.getItem("authToken");

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!username || !phone || !password) {
            setError("Пожалуйста, заполните все поля.");
            return;
        }

        try {
            const response = await axios.post(
                `${apiUrl}/api/admin/create-user`,
                { username, phone, password },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            alert(response.data.message);
            navigate("/users");
        } catch (err) {
            console.error("Ошибка при создании пользователя:", err);
            setError(err.response?.data?.message || "Ошибка при создании пользователя");
        }
    };

    return (
        <div className="create-user-page">
            <div className="create-user-card">
                <h2>Создать нового пользователя</h2>

                {error && <p className="error-message">{error}</p>}

                <form onSubmit={handleSubmit} className="create-user-form">
                    <div className="form-group">
                        <label htmlFor="username">Имя</label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Введите имя"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="phone">Номер телефона</label>
                        <input
                            type="text"
                            id="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+7XXXXXXXXXX"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Пароль</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Введите пароль"
                            required
                        />
                    </div>

                    <button type="submit" className="submit-button">
                        Создать пользователя
                    </button>
                </form>
            </div>
        </div>
    );
}

export default CreateUserPage;