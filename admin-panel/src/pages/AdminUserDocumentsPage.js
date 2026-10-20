import React from "react";
import { Link, useParams } from "react-router-dom";

import "../styles/AdminUserDocumentsPage.css";

function AdminUserDocumentsPage() {
    const { userId } = useParams();

    return (
        <main className="admin-user-documents">
            <h2>
                Документы пользователя #{userId}
            </h2>

            <p className="documents-message">
                Старый просмотр документов отключён.
                Новые заявки на подтверждение личности
                обрабатываются через защищённый раздел
                административной панели.
            </p>

            <Link to="/identity">
                Перейти к проверке личности
            </Link>
        </main>
    );
}

export default AdminUserDocumentsPage;