import { useEffect, useState } from "react";

const Notifications = () => {
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        fetch("/api/notifications")
            .then((res) => res.json())
            .then((data) => setNotifications(data.notifications));
    }, []);

    return (
        <div>
            <h2>Уведомления</h2>
            {notifications.map((notif, index) => (
                <p key={index}>{notif.message}</p>
            ))}
        </div>
    );
};

export default Notifications;
