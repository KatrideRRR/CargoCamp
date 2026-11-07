const test = require("node:test");
const assert = require("node:assert/strict");

const {
    verifyDocumentChain,
} = require("../services/verifiedDocumentChainService");

const assignmentHash = "a".repeat(64);
const actHash = "b".repeat(64);
const addendumHash = "c".repeat(64);

function makeAssignment() {
    return {
        id: 10,
        orderId: 5,
        type: "verified_assignment",
        version: 1,
        status: "fully_signed",
        fullySignedAt: new Date(),
        documentHash: assignmentHash,

        metadata: {
            snapshot: {
                terms: {
                    priceKopecks: 100000,
                },
            },
        },
    };
}

function makeAct() {
    return {
        id: 20,
        orderId: 5,
        parentContractId: 10,
        type: "verified_completion_act",
        version: 1,
        documentHash: actHash,

        metadata: {
            snapshot: {
                assignmentId: "10",
                assignmentHash,

                originalPriceKopecks: 100000,
                finalPriceKopecks: 100000,

                addenda: [],
            },
        },
    };
}

test("Корректная цепочка договора и акта v1", () => {
    assert.deepEqual(
        verifyDocumentChain({
            contract: makeAct(),
            assignment: makeAssignment(),
        }),
        []
    );
});

test("Подмена исходного договора обнаруживается", () => {
    const act = makeAct();

    act.metadata.snapshot.assignmentHash =
        "f".repeat(64);

    assert.notEqual(
        verifyDocumentChain({
            contract: act,
            assignment: makeAssignment(),
        }).length,
        0
    );
});

test("Неподписанный договор не подтверждает акт", () => {
    const assignment = makeAssignment();

    assignment.status = "draft";
    assignment.fullySignedAt = null;

    assert.notEqual(
        verifyDocumentChain({
            contract: makeAct(),
            assignment,
        }).length,
        0
    );
});

test("Акт другого заказа не подтверждается", () => {
    const act = makeAct();

    act.orderId = 999;

    assert.notEqual(
        verifyDocumentChain({
            contract: act,
            assignment: makeAssignment(),
        }).length,
        0
    );
});

test("Корректная новая цена через допсоглашение", () => {
    const act = makeAct();

    const addendum = {
        id: 30,
        orderId: 5,
        parentContractId: 10,
        type: "verified_addendum",
        status: "fully_signed",
        fullySignedAt: new Date(),
        supersededAt: null,
        documentHash: addendumHash,
    };

    act.metadata.snapshot.addenda = [
        {
            contractId: "30",
            documentHash: addendumHash,
            beforePriceKopecks: 100000,
            afterPriceKopecks: 150000,
        },
    ];

    act.metadata.snapshot.finalPriceKopecks =
        150000;

    assert.deepEqual(
        verifyDocumentChain({
            contract: act,
            assignment: makeAssignment(),
            addenda: [addendum],
        }),
        []
    );
});

test("Несогласованная стоимость обнаруживается", () => {
    const act = makeAct();

    act.metadata.snapshot.finalPriceKopecks =
        200000;

    assert.notEqual(
        verifyDocumentChain({
            contract: act,
            assignment: makeAssignment(),
        }).length,
        0
    );
});

test("Акт v2 связан с исходным актом v1", () => {
    const original = makeAct();

    original.supersededAt = new Date();

    const revised = makeAct();

    revised.id = 21;
    revised.version = 2;
    revised.parentContractId = 20;

    revised.metadata.snapshot.remediation = {
        previousActId: "20",
        previousDocumentHash: actHash,
    };

    assert.deepEqual(
        verifyDocumentChain({
            contract: revised,
            assignment: makeAssignment(),
            previousAct: original,
        }),
        []
    );
});

test("Подмена исходного акта v1 обнаруживается", () => {
    const original = makeAct();

    original.supersededAt = new Date();

    const revised = makeAct();

    revised.id = 21;
    revised.version = 2;
    revised.parentContractId = 20;

    revised.metadata.snapshot.remediation = {
        previousActId: "20",
        previousDocumentHash: "f".repeat(64),
    };

    assert.notEqual(
        verifyDocumentChain({
            contract: revised,
            assignment: makeAssignment(),
            previousAct: original,
        }).length,
        0
    );
});