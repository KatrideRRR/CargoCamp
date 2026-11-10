const test = require("node:test");
const assert = require("node:assert/strict");

const {
    summarizeDocumentSignatures,
} = require("../services/documentSignatureStatusService");

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const contract = {
    id: 601,
    documentHash: HASH,
};

const order = {
    creatorId: 2,
    executorId: 1,
};

const creator = {
    userId: 2,
    partyRole: "creator",
    method: "otp_sms",
    documentHash: HASH,
};

const executor = {
    userId: 1,
    partyRole: "executor",
    method: "authenticated_click",
    documentHash: HASH,
};

function check(signatures, options = {}) {
    return summarizeDocumentSignatures({
        signatures,
        contract: options.contract || contract,
        order: options.order || order,
    });
}

test(
    "первая подпись не завершает документ",
    () => {
        assert.deepEqual(
            check([creator]),
            {
                creatorSigned: true,
                executorSigned: false,
                fullySigned: false,
            }
        );
    }
);

test(
    "две правильные подписи завершают документ",
    () => {
        assert.deepEqual(
            check([creator, executor]),
            {
                creatorSigned: true,
                executorSigned: true,
                fullySigned: true,
            }
        );
    }
);

test(
    "две подписи одного пользователя не заменяют две стороны",
    () => {
        const duplicateRole = {
            ...creator,
            partyRole: "executor",
        };

        assert.equal(
            check([creator, duplicateRole]).fullySigned,
            false
        );
    }
);

test(
    "подпись с чужим SHA-256 не учитывается",
    () => {
        const wrongHash = {
            ...executor,
            documentHash: OTHER_HASH,
        };

        assert.equal(
            check([creator, wrongHash]).fullySigned,
            false
        );
    }
);

test(
    "перепутанные роли не допускаются",
    () => {
        assert.equal(
            check([
                {
                    ...creator,
                    partyRole: "executor",
                },
                {
                    ...executor,
                    partyRole: "creator",
                },
            ]).fullySigned,
            false
        );
    }
);

test(
    "неизвестный способ подписи не учитывается",
    () => {
        assert.equal(
            check([
                creator,
                {
                    ...executor,
                    method: "unknown",
                },
            ]).fullySigned,
            false
        );
    }
);

test(
    "посторонняя третья подпись блокирует итоговый статус",
    () => {
        assert.equal(
            check([
                creator,
                executor,
                {
                    userId: 999,
                    partyRole: "creator",
                    method: "otp_sms",
                    documentHash: HASH,
                },
            ]).fullySigned,
            false
        );
    }
);

test(
    "некорректные участники заказа не допускаются",
    () => {
        assert.equal(
            check([creator, executor], {
                order: {
                    creatorId: 2,
                    executorId: 2,
                },
            }).fullySigned,
            false
        );
    }
);