import React from "react";
import Modal from "react-modal";
import { FaMapMarkedAlt } from "react-icons/fa";
import "../styles/CreateExpressOrder.css";

Modal.setAppElement("#root");

const ExpressMapConfirmModal = ({ isOpen, onClose, from, to, routeUrl, onCreate, onEditFrom, onEditTo }) => {
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
                    <div className="exo-modalSub">Если адрес не тот — поправь через карту</div>
                </div>
                <button className="exo-x" onClick={onClose} type="button">✖</button>
            </div>

            <div className="exo-modalBody">
                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Откуда</div>
                    <div className="exo-previewText">{from?.address || "—"}</div>
                    <button className="exo-miniBtn" type="button" onClick={onEditFrom}>Изменить на карте</button>
                </div>

                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Куда</div>
                    <div className="exo-previewText">{to?.address || "—"}</div>
                    <button className="exo-miniBtn" type="button" onClick={onEditTo}>Изменить на карте</button>
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
                    Если точка не там — нажми “Изменить на карте”.
                </div>
            </div>
        </Modal>
    );
};

export default ExpressMapConfirmModal;