import React from "react";
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Navigate,
} from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import UsersPage from "./pages/UsersPage";
import OrdersPage from "./pages/OrdersPage";
import PrivateRoute from "./components/PrivateRoute";
import MessagesPage from "./pages/MessagesPage";
import OrderDetailsPage from "./pages/OrderDetailsPage";
import UserComplaintsPage from "./pages/UserComplaintsPage";
import UserOrdersPage from "./pages/UserOrdersPage";
import CreateUserPage from "./pages/CreateUserPage";
import AdminCreateOrderPage from "./pages/AdminCreateOrderPage";
import AdminUserDocumentsPage from "./pages/AdminUserDocumentsPage";
import AdminExpressOrderDetailsPage from "./pages/AdminExpressOrderDetailsPage";
import AdminSupportPage from "./pages/AdminSupportPage";

function App() {
    return (
        <Router>
            <Routes>
                <Route
                    path="/"
                    element={<Navigate to="/dashboard" replace />}
                />

                <Route
                    path="/login"
                    element={<LoginPage />}
                />

                <Route
                    path="/dashboard"
                    element={
                        <PrivateRoute>
                            <Dashboard />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/users"
                    element={
                        <PrivateRoute>
                            <UsersPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/orders"
                    element={
                        <PrivateRoute>
                            <OrdersPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/orders/:id"
                    element={
                        <PrivateRoute>
                            <OrderDetailsPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/express-orders/:id"
                    element={
                        <PrivateRoute>
                            <AdminExpressOrderDetailsPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/:orderId/messages"
                    element={
                        <PrivateRoute>
                            <MessagesPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/users/:userId/complaints"
                    element={
                        <PrivateRoute>
                            <UserComplaintsPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/users/:userId/orders"
                    element={
                        <PrivateRoute>
                            <UserOrdersPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/create-user"
                    element={
                        <PrivateRoute>
                            <CreateUserPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/create"
                    element={
                        <PrivateRoute>
                            <AdminCreateOrderPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/create-order/:userId"
                    element={
                        <PrivateRoute>
                            <AdminCreateOrderPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/support"
                    element={
                        <PrivateRoute>
                            <AdminSupportPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="/user-documents/:userId"
                    element={
                        <PrivateRoute>
                            <AdminUserDocumentsPage />
                        </PrivateRoute>
                    }
                />

                <Route
                    path="*"
                    element={<Navigate to="/" replace />}
                />
            </Routes>
        </Router>
    );
}

export default App;