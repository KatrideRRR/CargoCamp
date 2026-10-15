import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // если у тебя есть стили

import "./utils/setupAdminAxios";

// На React 18 используем createRoot
const root = ReactDOM.createRoot(
    document.getElementById("root")
);

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
