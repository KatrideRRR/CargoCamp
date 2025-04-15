import React from 'react';
import '../styles/Modal.css';

const Modal = ({ isOpen, onClose, title, children }) => {
    return (
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`}>
            <div className={`modal-content ${isOpen ? 'open' : ''}`}>
                <button className="modal-close" onClick={onClose}>&times;</button>
                {title && <h2>{title}</h2>}
                <div className="modal-body">{children}</div>

            </div>
        </div>
    );
};

export default Modal;
