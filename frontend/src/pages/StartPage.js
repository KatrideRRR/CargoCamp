import { useNavigate } from "react-router-dom";
import "../styles/StartPage.css";
import { AuthContext } from "../utils/authContext";
import { useContext } from "react";

export default function StartPage() {
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();

    return (
        <div className="start-page-container">
            <div className="start-page-content animate-in">
                <h1 className="title">CargoCamp</h1>
                <p className="subtitle">Что вы хотите сделать?</p>

                <div className="button-group">
                    <button
                        onClick={() => navigate("/create-order")}
                        className="role-button glassy"
                    >
                        <div className="emoji">🧾</div>
                        <div className="text">
                            <h2 className="role-title">Создать заказ</h2>
                            <p className="role-subtitle">Обычный заказ на услугу</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/express")}
                        className="role-button glassy"
                    >
                        <div className="emoji">🚕</div>
                        <div className="text">
                            <h2 className="role-title">Такси / Курьер</h2>
                            <p className="role-subtitle">Быстрый заказ “здесь и сейчас”</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/orders")}
                        className="role-button glassy soft"
                    >
                        <div className="emoji">📋</div>
                        <div className="text">
                            <h2 className="role-title">Все заказы</h2>
                            <p className="role-subtitle">Найти заказ и откликнуться</p>
                        </div>
                    </button>
                </div>

            </div>
        </div>
    );
}