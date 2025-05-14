import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from 'react-modal';
import '../styles/CreateOrderModal.css'

const CreateOrderModal = ({ isOpen, onClose }) => {
    const navigate = useNavigate();

    const handleChoice = (type) => {
        if (type === 'regular') {
            navigate('/create-order');
        } else if (type === 'express') {
            navigate('/express');
        }
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Выбор типа заказа"
            className="create-order-modal"
            overlayClassName="modal-overlay"
        >
            <h2>Какой заказ вы хотите создать?</h2>
            <div className="modal-options">
                <button onClick={() => handleChoice('regular')} className="modal-option">
                    📋 Обычный заказ
                </button>
                <button onClick={() => handleChoice('express')} className="modal-option express">
                    🚀 Такси / Курьер
                </button>
            </div>
            <button className="modal-close" onClick={onClose}>Отмена</button>
        </Modal>
    );
};

export default CreateOrderModal;
