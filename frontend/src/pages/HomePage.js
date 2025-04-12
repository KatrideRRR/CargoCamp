import { useEffect, useState } from 'react';

export default function HomePage() {
    const [role, setRole] = useState(null);

    useEffect(() => {
        const savedRole = localStorage.getItem('user_role');
        setRole(savedRole);
    }, []);

    const getTitle = () => {
        if (role === 'customer') return 'Ваши заказы';
        if (role === 'worker') return 'Доступные заказы';
        return 'Главная';
    };

    const getDescription = () => {
        if (role === 'customer') return 'Здесь вы можете создать новый заказ или следить за текущими.';
        if (role === 'worker') return 'Выбирайте заказы, которые готовы выполнить прямо сейчас.';
        return 'Добро пожаловать!';
    };

    return (
        <div className="min-h-screen bg-white p-6 flex flex-col items-center justify-start">
            <h1 className="text-3xl font-bold mb-4">{getTitle()}</h1>
            <p className="text-gray-600 text-center mb-8 max-w-lg">{getDescription()}</p>

            <div className="w-full max-w-3xl">
                <div className="p-4 rounded-xl border border-gray-200 shadow-sm text-center text-gray-400">
                    [ 🛠 Здесь будет основной интерфейс — список заказов, фильтры, карта и т.п. ]
                </div>
            </div>
        </div>
    );
}
