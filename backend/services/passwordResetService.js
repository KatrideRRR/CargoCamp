const bcrypt = require("bcrypt");

const {
    sequelize,
    User,
    AuthSession,
} = require("../models");

/**
 * Изменение пароля и отзыв сессий
 * выполняются в одной транзакции.
 *
 * Если любая операция завершается ошибкой,
 * транзакция откатывается.
 */
async function resetPasswordAndRevokeSessions({
                                                  phone,
                                                  newPassword,
                                              }) {
    // Хешируем пароль до открытия транзакции,
    // чтобы не удерживать блокировку во время bcrypt.
    const passwordHash = await bcrypt.hash(
        String(newPassword),
        10
    );

    return sequelize.transaction(async (transaction) => {
        const user = await User.findOne({
            where: {
                phone,
            },

            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!user) {
            const error = new Error(
                "Пользователь не найден"
            );

            error.status = 404;

            throw error;
        }

        await user.update(
            {
                password: passwordHash,
            },
            {
                transaction,
            }
        );

        // Отзываем все действующие сессии
        // пользователя, включая admin-сессии.
        await AuthSession.update(
            {
                revokedAt: new Date(),
            },
            {
                where: {
                    userId: user.id,
                    revokedAt: null,
                },

                transaction,
            }
        );

        return {
            userId: user.id,
        };
    });
}

module.exports = {
    resetPasswordAndRevokeSessions,
};