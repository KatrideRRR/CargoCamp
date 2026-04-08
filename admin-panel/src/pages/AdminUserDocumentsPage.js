import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "../styles/AdminUserDocumentsPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function AdminUserDocumentsPage() {
    const { userId } = useParams();
    const [documents, setDocuments] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDocuments = async () => {
            try {
                const token = localStorage.getItem("authToken");
                const response = await axios.get(
                    `${apiUrl}/api/admin/user-documents/${userId}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );

                setDocuments(response.data.documents || []);
            } catch (err) {
                console.error("Ошибка при загрузке документов:", err);
                setError("Не удалось загрузить документы");
            } finally {
                setLoading(false);
            }
        };

        fetchDocuments();
    }, [userId]);

    if (loading) {
        return (
            <div className="admin-user-documents">
                <h2>Документы пользователя #{userId}</h2>
                <p className="documents-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="admin-user-documents">
                <h2>Документы пользователя #{userId}</h2>
                <p className="documents-message error-text">{error}</p>
            </div>
        );
    }

    return (
        <div className="admin-user-documents">
            <h2>Документы пользователя #{userId}</h2>

            {documents.length > 0 ? (
                <div className="documents-list">
                    {documents.map((doc, index) => (
                        <a
                            key={index}
                            href={`${apiUrl}/uploads/upload-document/${doc}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="document-item"
                        >
                            <img
                                src={`${apiUrl}/uploads/upload-document/${doc}`}
                                alt={`Документ ${index + 1}`}
                            />
                            <span className="document-label">Документ {index + 1}</span>
                        </a>
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <p>Документы отсутствуют</p>
                </div>
            )}
        </div>
    );
}

export default AdminUserDocumentsPage;