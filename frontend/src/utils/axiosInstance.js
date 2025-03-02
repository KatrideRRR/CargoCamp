import axios from 'axios';
const apiUrl = process.env.REACT_APP_API_URL;

const axiosInstance = axios.create({
    baseURL: `${apiUrl}/api`,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
    },
});

axiosInstance.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            try {
                const refreshToken = localStorage.getItem('refreshToken');
                if (!refreshToken) {
                    console.warn('⚠️ Нет refresh-токена.');
                    return Promise.reject(error);
                }

                const refreshResponse = await axios.post('/api/token', { token: refreshToken });
                const newAccessToken = refreshResponse.data.accessToken;

                localStorage.setItem('authToken', newAccessToken);
                axiosInstance.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;

                originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
                return axiosInstance(originalRequest);
            } catch (refreshError) {
                console.error('❌ Ошибка обновления токена:', refreshError);
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

// 🔄 Фоновая проверка и обновление токена
const refreshAccessToken = async () => {
    try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return;

        const response = await axios.post('/api/token', { token: refreshToken });
        const newAccessToken = response.data.accessToken;

        localStorage.setItem('authToken', newAccessToken);
        axiosInstance.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;
        console.log('🔄 Токен обновлён в фоне');
    } catch (error) {
        console.error('⚠️ Ошибка обновления токена в фоне:', error);
    }
};

// Обновляем токен каждые 10 минут
setInterval(refreshAccessToken, 10 * 60 * 1000);

export default axiosInstance;
