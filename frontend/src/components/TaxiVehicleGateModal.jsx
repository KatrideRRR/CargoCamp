import React from "react";
import { FaCarSide } from "react-icons/fa";

const TaxiVehicleGateModal = ({
                                  data,
                                  onClose,
                                  onGoToProfile,
                              }) => {
    if (!data) {
        return null;
    }

    const isPending =
        data.code === "TAXI_VEHICLE_PENDING";

    let title = "Автомобиль не подтверждён";

    if (data.code === "TAXI_VEHICLE_REQUIRED") {
        title = "Добавьте автомобиль";
    }

    if (data.code === "TAXI_VEHICLE_PENDING") {
        title = "Автомобиль проверяется";
    }

    if (data.code === "TAXI_VEHICLE_REJECTED") {
        title = "Автомобиль не прошёл проверку";
    }

    return (
        <div
            className="taxi-vehicle-gate-overlay"
            onClick={onClose}
        >
            <div
                className="taxi-vehicle-gate-modal"
                onClick={(e) =>
                    e.stopPropagation()
                }
            >
                <div className="taxi-vehicle-gate-icon">
                    <FaCarSide />
                </div>

                <h3>{title}</h3>

                <p>
                    {data.message ||
                        "Для работы в такси необходимо добавить и подтвердить автомобиль."}
                </p>

                <div className="taxi-vehicle-gate-actions">
                    <button
                        type="button"
                        className="taxi-vehicle-gate-cancel"
                        onClick={onClose}
                    >
                        Закрыть
                    </button>

                    {!isPending && (
                        <button
                            type="button"
                            className="taxi-vehicle-gate-profile"
                            onClick={onGoToProfile}
                        >
                            Перейти в профиль
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TaxiVehicleGateModal;