import {useNavigate} from 'react-router-dom';
import '../styles/StartPage.css';
import {AuthContext} from "../utils/authContext";
import {useContext} from "react";

export default function StartPage() {
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    return (
        <div className="start-page-container">
            <div className="start-page-content animate-in">
                <h1 className="title">Добро пожаловать!</h1>
                <p className="subtitle">Кем вы хотите быть сегодня?</p>

                <div className="button-group">
                    <button
                        onClick={() => navigate(`/my-orders/${user.id}`)}
                        className="role-button glassy"
                    >
                        <div className="emoji">🧑‍💼</div>
                        <div className="text">
                            <h2 className="role-title">Я заказчик</h2>
                            <p className="role-subtitle">Создать или отслеживать заказы</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate('/orders')}
                        className="role-button glassy"
                    >
                        <div className="emoji">🔧</div>
                        <div className="text">
                            <h2 className="role-title">Я исполнитель</h2>
                            <p className="role-subtitle">Найти заказы и начать работу</p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
