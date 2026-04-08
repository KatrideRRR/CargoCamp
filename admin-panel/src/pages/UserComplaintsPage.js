import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "../styles/UserComplaintsPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function UserComplaintsPage() {
    const { userId } = useParams();
    const [complaints, setComplaints] = useState([]);
    const [username, setUsername] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const token = localStorage.getItem("authToken");

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/admin/users/${userId}/complaints`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                setUsername(response.data.username || "");
                setComplaints(response.data.complaints || []);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Ошибка загрузки жалоб", error);
                setError("Не удалось загрузить жалобы");
                setLoading(false);
            });
    }, [userId, token]);

    if (loading) {
        return (
            <div className="complaints-container">
                <h1>Жалобы пользователя #{userId}</h1>
                <p className="complaints-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="complaints-container">
                <h1>Жалобы пользователя #{userId}</h1>
                <p className="complaints-message error">{error}</p>
            </div>
        );
    }

    return (
        <div className="complaints-container">
            <h1>
                Жалобы на {username || "пользователя"} #{userId}
            </h1>

            {complaints.length === 0 ? (
                <div className="empty-state">
                    <p>На этого пользователя нет жалоб.</p>
                </div>
            ) : (
                <div className="complaints-table-wrapper">
                    <table className="complaints-table">
                        <thead>
                        <tr>
                            <th>Дата</th>
                            <th>Текст жалобы</th>
                        </tr>
                        </thead>
                        <tbody>
                        {complaints.map((complaint, index) => (
                            <tr key={index}>
                                <td>
                                    {complaint.date
                                        ? new Date(complaint.date).toLocaleDateString()
                                        : "—"}
                                </td>
                                <td>{complaint.complaintText || "—"}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default UserComplaintsPage;