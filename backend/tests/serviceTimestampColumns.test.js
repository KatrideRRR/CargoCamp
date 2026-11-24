"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Sequelize } = require("sequelize");

const createServiceModel = require("../models/Service");

test("Service uses existing MySQL timestamp column names", async () => {
    const sequelize = new Sequelize(
        "test_only",
        "test_only",
        "test_only",
        {
            dialect: "mysql",
            logging: false,
        }
    );

    try {
        const Service = createServiceModel(sequelize);
        const attrs = Service.getAttributes();

        assert.equal(Service.getTableName(), "services");

        assert.equal(attrs.createdAt?.field, "createdAt");
        assert.equal(attrs.updatedAt?.field, "updatedAt");

        assert.equal(attrs.created_at, undefined);
        assert.equal(attrs.updated_at, undefined);
    } finally {
        await sequelize.close();
    }
});
