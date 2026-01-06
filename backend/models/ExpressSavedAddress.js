module.exports = (sequelize, DataTypes) => {
    const ExpressSavedAddress = sequelize.define(
        "ExpressSavedAddress",
        {
            id: {
                type: DataTypes.INTEGER.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            userId: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
                field: "user_id",
            },

            label: {
                type: DataTypes.ENUM("home", "work", "other"),
                allowNull: false,
                defaultValue: "other",
            },

            title: {
                type: DataTypes.STRING(64),
                allowNull: true,
            },

            address: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },

            lat: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
            },

            lng: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
            },

            useCount: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                field: "use_count",
            },

            lastUsedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "last_used_at",
            },
        },
        {
            tableName: "express_saved_addresses",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            indexes: [
                { fields: ["user_id"] },
                { fields: ["label"] },
                { fields: ["use_count"] },
                { fields: ["last_used_at"] },
                { unique: true, fields: ["user_id", "address"] },
            ],
        }
    );

    ExpressSavedAddress.associate = (models) => {
        ExpressSavedAddress.belongsTo(models.User, {
            foreignKey: "userId",
            as: "user",
            onDelete: "CASCADE",
        });
    };

    return ExpressSavedAddress;
};