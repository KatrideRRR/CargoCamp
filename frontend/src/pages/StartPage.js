import { useNavigate } from 'react-router-dom';

export default function StartPage() {
    const navigate = useNavigate();

    const handleChoose = (role) => {
        localStorage.setItem('user_role', role);
        navigate('/home');
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-white px-4 py-10">
            <h1 className="text-4xl font-extrabold text-gray-800 mb-4 text-center">
                Добро пожаловать!
            </h1>
            <p className="text-lg text-gray-600 mb-10 text-center">
                Кем вы хотите быть сегодня?
            </p>

            <div className="w-full max-w-md grid grid-cols-1 gap-6">
                <button
                    onClick={() => handleChoose('customer')}
                    className="flex items-center gap-4 p-6 rounded-2xl bg-white shadow-lg hover:shadow-2xl hover:bg-gray-50 transition-all duration-300"
                >
                    <div className="text-4xl">🧑‍💼</div>
                    <div className="text-left">
                        <h2 className="text-xl font-semibold text-gray-800">Я заказчик</h2>
                        <p className="text-gray-500 text-sm">Создать или отслеживать заказы</p>
                    </div>
                </button>

                <button
                    onClick={() => handleChoose('worker')}
                    className="flex items-center gap-4 p-6 rounded-2xl bg-white shadow-lg hover:shadow-2xl hover:bg-gray-50 transition-all duration-300"
                >
                    <div className="text-4xl">🔧</div>
                    <div className="text-left">
                        <h2 className="text-xl font-semibold text-gray-800">Я исполнитель</h2>
                        <p className="text-gray-500 text-sm">Найти заказы и начать работу</p>
                    </div>
                </button>
            </div>
        </div>
    );
}
