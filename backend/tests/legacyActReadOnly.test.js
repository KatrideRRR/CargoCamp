const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("node:crypto");
const { Op } = require("sequelize");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const HASH = "a".repeat(64);

test("Исторические акты доступны для чтения, но не для повторной приёмки", async () => {
    const act = {
        id: 601,
        orderId: 123,
        version: 1,
        type: "verified_completion_act",
        status: "draft",
        documentHash: HASH,
        fullySignedAt: null,
        supersededAt: null,
    };

    const order = {
        id: 123,
        creatorId: 1,
        executorId: 2,
        status: "completed",
    };

    const decision = {
        id: 10,
        actorUserId: 1,
        eventAt: new Date(),
        metadata: {
            decision: "remarks",
            comment: "Исторические замечания заказчика",
            documentHash: HASH,
        },
    };

    const models = {
        Order: {
            async findByPk(id) {
                return Number(id) === 123 ? order : null;
            },
        },

        Contract: {
            async findOne({ where }) {
                if (where.version === 2) return null;

                return Number(where.id) === 601
                    ? act
                    : null;
            },
        },

        ContractEvent: {
            async findOne() {
                return decision;
            },

            async findAll() {
                return [];
            },

            async create() {
                throw new Error(
                    "Историческое решение нельзя изменять"
                );
            },
        },

        Dispute: {
            async findOne() {
                return null;
            },
        },
    };

    const authenticate = (req, res, next) => {
        req.user = { id: 1 };
        next();
    };

    const dependencies = {
        express,
        crypto,
        sequelize: { Op },
        "../middlewares/userAuth": authenticate,
        "../models": models,
    };

    const app = express();
    app.use(express.json());

    app.use(
        "/api/contracts/acts",
        loadIsolatedRouter(
            "actRemediation.js",
            dependencies
        )
    );

    app.use(
        "/api/contracts/acts",
        loadIsolatedRouter(
            "actAcceptance.js",
            dependencies
        )
    );

    const server = await new Promise((resolve) => {
        const instance = app.listen(
            0,
            "127.0.0.1",
            () => resolve(instance)
        );
    });

    const base =
        `http://127.0.0.1:${server.address().port}`;

    try {
        const blockedPaths = [
            "/api/contracts/acts/601/acceptance",
            "/api/contracts/acts/601/remediation/submit",
            "/api/contracts/acts/601/remediation/review",
        ];

        for (const path of blockedPaths) {
            const response = await fetch(base + path, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    decision: "accepted",
                    approved: true,
                }),
            });

            const body = await response.json();

            assert.equal(response.status, 410);
            assert.equal(body.success, false);
        }

        const acceptanceResponse = await fetch(
            `${base}/api/contracts/acts/601/acceptance`
        );

        assert.equal(acceptanceResponse.status, 200);

        const acceptance =
            await acceptanceResponse.json();

        assert.equal(acceptance.canDecide, false);
        assert.equal(
            acceptance.canRequestCorrections,
            false
        );

        assert.equal(
            acceptance.decision.decision,
            "remarks"
        );

        const remediationResponse = await fetch(
            `${base}/api/contracts/acts/601/remediation`
        );

        assert.equal(remediationResponse.status, 200);

        const remediation =
            await remediationResponse.json();

        assert.equal(remediation.canSubmit, false);
        assert.equal(remediation.canReview, false);

        assert.equal(
            remediation.originalRemarks,
            "Исторические замечания заказчика"
        );
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
});