
const {
    sequelize,
    User,
} = require("../models");

const VEHICLE_FIELDS = Object.freeze([
    "vehicleBrand",
    "vehicleModel",
    "vehicleColor",
    "vehiclePlate",
    "vehicleYear",
    "vehiclePhoto",
    "vehicleVerificationStatus",
]);

function vehicleError(status, message) {
    const error = new Error(message);
    error.httpStatus = status;
    return error;
}

function getVehicleSnapshot(user) {
    return Object.fromEntries(
        VEHICLE_FIELDS.map((field) => [
            field,
            user?.[field] ?? null,
        ])
    );
}

function assertVehicleSnapshot(user, expected) {
    if (
        !expected ||
        typeof expected !== "object" ||
        Array.isArray(expected)
    ) {
        throw vehicleError(
            409,
            "Данные автомобиля необходимо обновить перед принятием решения"
        );
    }

    const current = getVehicleSnapshot(user);

    const matches = VEHICLE_FIELDS.every((field) =>
        Object.prototype.hasOwnProperty.call(
            expected,
            field
        ) &&
        String(expected[field] ?? "") ===
        String(current[field] ?? "")
    );

    if (!matches) {
        throw vehicleError(
            409,
            "Автомобиль был изменён. Обновите список пользователей и проверьте актуальные данные."
        );
    }
}

async function mutateVehicleWithLock(userId, mutate) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw vehicleError(
            400,
            "Некорректный ID пользователя"
        );
    }

    return sequelize.transaction(
        async (transaction) => {
            const user = await User.findByPk(id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!user) {
                throw vehicleError(
                    404,
                    "Пользователь не найден"
                );
            }

            await mutate(user);

            await user.save({ transaction });

            return user;
        }
    );
}

module.exports = {
    getVehicleSnapshot,
    assertVehicleSnapshot,
    mutateVehicleWithLock,
};
