import { useNavigate } from "react-router-dom";
import "../styles/StartPage.css";

export default function StartPage() {
    const navigate = useNavigate();

    return (
        <div className="start-page-container">
            <div className="start-page-content">
                <h1 className="title">CargoCamp</h1>
                <p className="subtitle">Что вы хотите сделать?</p>

                <div className="button-group">
                    <button
                        onClick={() => navigate("/create-order")}
                        className="role-button"
                        type="button"
                    >
                        <div className="emoji">🧾</div>
                        <div className="text">
                            <h2 className="role-title">Создать заказ</h2>
                            <p className="role-subtitle">Обычный заказ на услугу</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/express")}
                        className="role-button"
                        type="button"
                    >
                        <div className="emoji">🚕</div>
                        <div className="text">
                            <h2 className="role-title">Такси / Курьер</h2>
                            <p className="role-subtitle">Быстрый заказ “здесь и сейчас”</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/orders")}
                        className="role-button role-button-soft"
                        type="button"
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