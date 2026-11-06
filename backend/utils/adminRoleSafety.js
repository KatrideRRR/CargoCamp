function getAdminSelfActionError({
                                     actorId,
                                     targetUser,
                                     nextRole,
                                 }) {
    if (!targetUser || targetUser.role !== "admin") {
        return null;
    }

    if (String(actorId) !== String(targetUser.id)) {
        return null;
    }

    if (nextRole === "user") {
        return "Нельзя снять права администратора у самого себя";
    }

    if (nextRole === "banned") {
        return "Нельзя заблокировать собственную учётную запись администратора";
    }

    return null;
}

module.exports = {
    getAdminSelfActionError,
};