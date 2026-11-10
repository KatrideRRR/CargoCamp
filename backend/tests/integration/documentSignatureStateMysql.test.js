const test = require("node:test");
const assert = require("node:assert/strict");

const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
} = require("sequelize");

const {
    getDocumentSignatureState,
} = require("../../services/documentSignatureStatusService");

const DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: false,
});

const TABLE = "cc_document_signatures_test";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

test(
    "Подписи документа: участники, SHA-256 и MySQL",
    async () => {
        let connection;
        let sequelize;
        let verified = false;

        try {
            connection = await mysql.createConnection(DB);

            const [[identity]] = await connection.query(`
                SELECT
                    @@hostname AS hostname,
                    DATABASE() AS databaseName,
                    CURRENT_USER() AS databaseUser
            `);

            assert.equal(
                identity.hostname,
                "cc-chat-mysql-test"
            );

            assert.equal(
                identity.databaseName,
                DB.database
            );

            assert.match(
                String(identity.databaseUser),
                /^cc_chat_test@/
            );

            verified = true;

            await connection.query(
                `DROP TABLE IF EXISTS ${TABLE}`
            );

            await connection.query(`
                CREATE TABLE ${TABLE} (
                    id BIGINT UNSIGNED NOT NULL
                        AUTO_INCREMENT PRIMARY KEY,

                    contract_id BIGINT UNSIGNED NOT NULL,
                    user_id INT NOT NULL,
                    party_role VARCHAR(32) NOT NULL,
                    method VARCHAR(50) NOT NULL,
                    document_hash CHAR(64) NOT NULL,

                    UNIQUE KEY uq_test_signature_party (
                        contract_id,
                        user_id,
                        party_role
                    )
                ) ENGINE=InnoDB
            `);

            sequelize = new Sequelize(
                DB.database,
                DB.user,
                DB.password,
                {
                    dialect: "mysql",
                    host: DB.host,
                    port: DB.port,
                    logging: false,
                    pool: {
                        max: 5,
                        min: 0,
                    },
                }
            );

            const Signature = sequelize.define(
                "TestSignature",
                {
                    id: {
                        type: DataTypes.BIGINT.UNSIGNED,
                        primaryKey: true,
                        autoIncrement: true,
                    },

                    contractId: {
                        type: DataTypes.BIGINT.UNSIGNED,
                        field: "contract_id",
                    },

                    userId: {
                        type: DataTypes.INTEGER,
                        field: "user_id",
                    },

                    partyRole: {
                        type: DataTypes.STRING,
                        field: "party_role",
                    },

                    method: DataTypes.STRING,

                    documentHash: {
                        type: DataTypes.CHAR(64),
                        field: "document_hash",
                    },
                },
                {
                    tableName: TABLE,
                    timestamps: false,
                }
            );

            const contract = {
                id: 601,
                documentHash: HASH,
            };

            const order = {
                creatorId: 2,
                executorId: 1,
            };

            const readState = (transaction = null) =>
                getDocumentSignatureState({
                    ContractSignature: Signature,
                    contract,
                    order,
                    transaction,
                });

            // Документ ещё никем не подписан.
            assert.equal(
                (await readState()).fullySigned,
                false
            );

            // Первичная подпись заказчика через SMS.
            await Signature.create({
                contractId: 601,
                userId: 2,
                partyRole: "creator",
                method: "otp_sms",
                documentHash: HASH,
            });

            let state = await readState();

            assert.equal(state.creatorSigned, true);
            assert.equal(state.executorSigned, false);
            assert.equal(state.fullySigned, false);

            // Запись того же пользователя под другой
            // ролью не должна заменять исполнителя.
            const wrongRole = await Signature.create({
                contractId: 601,
                userId: 2,
                partyRole: "executor",
                method: "otp_sms",
                documentHash: HASH,
            });

            assert.equal(
                (await readState()).fullySigned,
                false
            );

            await Signature.destroy({
                where: {
                    id: wrongRole.id,
                },
            });

            // Подпись исполнителя с другим хэшем.
            await Signature.create({
                contractId: 601,
                userId: 1,
                partyRole: "executor",
                method: "authenticated_click",
                documentHash: OTHER_HASH,
            });

            assert.equal(
                (await readState()).fullySigned,
                false
            );

            // После исправления хэша — две
            // правильные подписи того же PDF.
            await Signature.update(
                {
                    documentHash: HASH,
                },
                {
                    where: {
                        contractId: 601,
                        userId: 1,
                    },
                }
            );

            state = await readState();

            assert.equal(state.creatorSigned, true);
            assert.equal(state.executorSigned, true);
            assert.equal(state.fullySigned, true);

            // MySQL отклоняет повторную запись
            // той же стороны.
            await assert.rejects(
                Signature.create({
                    contractId: 601,
                    userId: 1,
                    partyRole: "executor",
                    method: "otp_sms",
                    documentHash: HASH,
                }),
                (error) =>
                    error.name ===
                    "SequelizeUniqueConstraintError"
            );

            // Подпись другого документа
            // не влияет на текущий акт.
            await Signature.create({
                contractId: 999,
                userId: 3,
                partyRole: "creator",
                method: "otp_sms",
                documentHash: HASH,
            });

            assert.equal(
                (await readState()).fullySigned,
                true
            );

            // Посторонняя запись в том же акте
            // рассматривается как нарушение состояния.
            const foreign = await Signature.create({
                contractId: 601,
                userId: 3,
                partyRole: "creator",
                method: "otp_sms",
                documentHash: HASH,
            });

            assert.equal(
                (await readState()).fullySigned,
                false
            );

            await Signature.destroy({
                where: {
                    id: foreign.id,
                },
            });

            assert.equal(
                (await readState()).fullySigned,
                true
            );

            // Подмена хэша самого документа
            // делает сохранённые подписи неприменимыми.
            contract.documentHash = OTHER_HASH;

            assert.equal(
                (await readState()).fullySigned,
                false
            );

            contract.documentHash = HASH;

            assert.equal(
                (await readState()).fullySigned,
                true
            );

        } finally {
            if (sequelize) {
                await sequelize.close();
            }

            if (connection) {
                try {
                    if (verified) {
                        await connection.query(
                            `DROP TABLE IF EXISTS ${TABLE}`
                        );
                    }
                } finally {
                    await connection.end();
                }
            }
        }
    }
);