const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getAdminSelfActionError,
} = require("../utils/adminRoleSafety");

test("администратор не может снять собственные права", () => {
    const error = getAdminSelfActionError({
        actorId: 1,
        targetUser: {
            id: 1,
            role: "admin",
        },
        nextRole: "user",
    });

    assert.equal(
        error,
        "Нельзя снять права администратора у самого себя"
    );
});

test("администратор не может заблокировать себя", () => {
    const error = getAdminSelfActionError({
        actorId: 1,
        targetUser: {
            id: 1,
            role: "admin",
        },
        nextRole: "banned",
    });

    assert.equal(
        error,
        "Нельзя заблокировать собственную учётную запись администратора"
    );
});

test("другому администратору можно снять права", () => {
    const error = getAdminSelfActionError({
        actorId: 1,
        targetUser: {
            id: 2,
            role: "admin",
        },
        nextRole: "user",
    });

    assert.equal(error, null);
});

test("обычного пользователя можно заблокировать", () => {
    const error = getAdminSelfActionError({
        actorId: 1,
        targetUser: {
            id: 3,
            role: "user",
        },
        nextRole: "banned",
    });

    assert.equal(error, null);
});

test("выдача административных прав не блокируется", () => {
    const error = getAdminSelfActionError({
        actorId: 1,
        targetUser: {
            id: 2,
            role: "user",
        },
        nextRole: "admin",
    });

    assert.equal(error, null);
});

test("строковый ID корректно сравнивается с числовым", () => {
    const error = getAdminSelfActionError({
        actorId: "15",
        targetUser: {
            id: 15,
            role: "admin",
        },
        nextRole: "user",
    });

    assert.ok(error);
});