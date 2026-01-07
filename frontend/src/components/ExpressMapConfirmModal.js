import React from "react";
import Modal from "react-modal";
import { FaMapMarkedAlt } from "react-icons/fa";
import "../styles/CreateExpressOrder.css";

Modal.setAppElement("#root");

const ExpressMapConfirmModal = ({ isOpen, onClose, from, to, routeUrl, onCreate }) => {
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="exo-modal"
            overlayClassName="exo-overlay"
            contentLabel="Проверка маршрута"
        >
            <div className="exo-modalHead">
                <div>
                    <div className="exo-modalTitle">Проверь “Откуда → Куда”</div>
                    <div className="exo-modalSub">Чтобы водитель/курьер не искал и приехал быстрее</div>
                </div>
                <button className="exo-x" onClick={onClose} type="button">
                    ✖
                </button>
            </div>

            <div className="exo-modalBody">
                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Откуда</div>
                    <div className="exo-previewText">{from?.address || "—"}</div>
                    <div className="exo-previewSmall">{from?.lat || "—"}, {from?.lng || "—"}</div>
                </div>

                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Куда</div>
                    <div className="exo-previewText">{to?.address || "—"}</div>
                    <div className="exo-previewSmall">{to?.lat || "—"}, {to?.lng || "—"}</div>
                </div>

                <div className="exo-modalActions">
                    <a
                        className="exo-btn exo-btnGhost"
                        href={routeUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => !routeUrl && e.preventDefault()}
                    >
                        <FaMapMarkedAlt /> Открыть в Яндекс.Навигаторе
                    </a>

                    <button className="exo-btn exo-btnPrimary" type="button" onClick={onCreate}>
                        Всё верно — создать
                    </button>
                </div>

                <div className="exo-note">
                    Если видишь, что точка не там — выбери её на карте (кнопка “Карта” рядом с полем).
                </div>
            </div>
        </Modal>
    );
};

export default ExpressMapConfirmModal;