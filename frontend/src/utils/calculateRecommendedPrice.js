const WASTE_TYPE_LABELS = {
    construction: "Строительный мусор",
    furniture: "Старая мебель",
    household: "Бытовой мусор",
    garden: "Садовый мусор",
    other: "Другой тип мусора",
};

const WASTE_VOLUME_LABELS = {
    small: "Несколько мешков",
    medium: "До одной Газели",
    large: "Больше одной Газели",
    unknown: "Объём пока неизвестен",
};

const APPLIANCE_TYPE_LABELS = {
    washing_machine: "Стиральная машина",
    refrigerator: "Холодильник",
    dishwasher: "Посудомоечная машина",
    oven: "Духовка",
    other: "Другая техника",
};

const COMPLEXITY_LABELS = {
    simple: "Простая работа",
    medium: "Средняя сложность",
    complex: "Сложная работа",
    unknown: "Сложность пока неизвестна",
};

const HOURLY_WORK_TYPE_LABELS = {
    leak: "Устранение течи",
    faucet: "Работа со смесителем",
    toilet: "Работа с унитазом",
    sink: "Работа с раковиной",
    pipes: "Работы с трубами",

    socket: "Розетки или выключатели",
    lighting: "Освещение",
    wiring: "Электропроводка",
    breaker: "Автомат или электрощит",
    diagnostics: "Диагностика",

    other: "Другая работа",
};

const AIR_CONDITIONER_WORK_LABELS = {
    installation: "Установка кондиционера",
    removal: "Демонтаж кондиционера",
    cleaning: "Чистка и обслуживание",
    repair: "Ремонт кондиционера",
    refill: "Заправка фреоном",
    diagnostics: "Диагностика",
    other: "Другая работа",
};

const BLOCKAGE_TYPE_LABELS = {
    sink: "Засор раковины или мойки",
    bath: "Засор ванны или душа",
    toilet: "Засор унитаза",
    apartment_pipe: "Засор трубы в квартире",
    main_pipe: "Засор основной трубы",
    unknown: "Тип засора неизвестен",
};

function calculateSewerCleaningPrice(
    config,
    details
) {
    const visitPrice = Math.max(
        0,
        toFiniteNumber(config.visitPrice)
    );

    const blockageType = String(
        details.blockageType || "unknown"
    );

    const blockageCharge = Math.max(
        0,
        getObjectPrice(
            config.blockageTypePrices,
            blockageType
        )
    );

    const complexity = String(
        details.complexity || "unknown"
    );

    const complexityCharge = Math.max(
        0,
        getObjectPrice(
            config.complexityPrices,
            complexity
        )
    );

    const emergencyCharge =
        details.isEmergency === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.emergencyPrice
                )
            )
            : 0;

    const equipmentCharge =
        details.equipmentRequired === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.equipmentPrice
                )
            )
            : 0;

    const breakdown = [];

    if (visitPrice > 0) {
        breakdown.push({
            key: "visit",
            label: "Выезд специалиста",
            amount: visitPrice,
        });
    }

    if (blockageCharge > 0) {
        breakdown.push({
            key: "blockage",
            label:
                BLOCKAGE_TYPE_LABELS[
                    blockageType
                    ] ||
                "Тип засора",
            amount: blockageCharge,
        });
    }

    if (complexityCharge > 0) {
        breakdown.push({
            key: "complexity",
            label:
                COMPLEXITY_LABELS[complexity] ||
                "Сложность засора",
            amount: complexityCharge,
        });
    }

    if (emergencyCharge > 0) {
        breakdown.push({
            key: "emergency",
            label: "Срочный выезд",
            amount: emergencyCharge,
        });
    }

    if (equipmentCharge > 0) {
        breakdown.push({
            key: "equipment",
            label:
                "Использование специального оборудования",
            amount: equipmentCharge,
        });
    }

    return {
        rawPrice:
            visitPrice +
            blockageCharge +
            complexityCharge +
            emergencyCharge +
            equipmentCharge,

        breakdown,
    };
}

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(value, min, max) {
    return Math.min(
        Math.max(value, min),
        max
    );
}

function getObjectPrice(
    priceObject,
    selectedKey,
    fallback = 0
) {
    if (
        !priceObject ||
        typeof priceObject !== "object" ||
        Array.isArray(priceObject)
    ) {
        return fallback;
    }

    return toFiniteNumber(
        priceObject[selectedKey],
        fallback
    );
}

function calculateFloorCharge({
                                  floor,
                                  hasElevator,
                                  pricePerFloor,
                              }) {
    const safeFloor = Math.max(
        0,
        toFiniteNumber(floor, 0)
    );

    if (hasElevator === true) {
        return 0;
    }

    return safeFloor * pricePerFloor;
}

function calculateTwoAddressFloorCharges(
    config,
    details
) {
    const pricePerFloor = Math.max(
        0,
        toFiniteNumber(
            config.pricePerFloorWithoutElevator
        )
    );

    const fromFloorCharge =
        calculateFloorCharge({
            floor: details.floorFrom,
            hasElevator:
            details.hasElevatorFrom,
            pricePerFloor,
        });

    const toFloorCharge =
        calculateFloorCharge({
            floor: details.floorTo,
            hasElevator:
            details.hasElevatorTo,
            pricePerFloor,
        });

    return {
        fromFloorCharge,
        toFloorCharge,
        total:
            fromFloorCharge +
            toFloorCharge,
    };
}

/*
 * Городские грузоперевозки:
 *
 * вызов машины один раз
 * + машина × количество часов
 * + грузчики × количество часов
 * + этажи без лифта один раз
 */
function calculateCargoHourlyPrice(
    config,
    details
) {
    const calloutPrice = Math.max(
        0,
        toFiniteNumber(
            config.calloutPrice
        )
    );

    const vehicleHourlyRate = Math.max(
        0,
        toFiniteNumber(
            config.vehicleHourlyRate
        )
    );

    const helperHourlyRate = Math.max(
        0,
        toFiniteNumber(
            config.helperHourlyRate
        )
    );

    const helpersCount = Math.max(
        0,
        toFiniteNumber(
            details.helpersCount
        )
    );

    const requestedHours = Math.max(
        0,
        toFiniteNumber(
            details.estimatedHours
        )
    );

    const minimumHours = Math.max(
        1,
        toFiniteNumber(
            config.minimumHours,
            1
        )
    );

    const billedHours = Math.max(
        requestedHours,
        minimumHours
    );

    const vehicleCharge =
        vehicleHourlyRate *
        billedHours;

    const helpersHourlyTotal =
        helpersCount *
        helperHourlyRate;

    const helpersCharge =
        helpersHourlyTotal *
        billedHours;

    const {
        fromFloorCharge,
        toFloorCharge,
        total: floorsCharge,
    } = calculateTwoAddressFloorCharges(
        config,
        details
    );

    const firstHourPrice =
        calloutPrice +
        vehicleHourlyRate +
        helpersHourlyTotal +
        floorsCharge;

    const nextHourPrice =
        vehicleHourlyRate +
        helpersHourlyTotal;

    const breakdown = [];

    if (calloutPrice > 0) {
        breakdown.push({
            key: "vehicle_callout",
            label: "Вызов машины",
            amount: calloutPrice,
        });
    }

    if (vehicleCharge > 0) {
        breakdown.push({
            key: "vehicle_hours",
            label:
                `Машина: ${billedHours} ч × ${vehicleHourlyRate} ₽`,
            amount: vehicleCharge,
        });
    }

    if (helpersCharge > 0) {
        breakdown.push({
            key: "helpers_hours",
            label:
                `${helpersCount} грузчик(а) × ${billedHours} ч × ${helperHourlyRate} ₽`,
            amount: helpersCharge,
        });
    }

    if (fromFloorCharge > 0) {
        breakdown.push({
            key: "floor_from",
            label:
                "Этажи без лифта по первому адресу",
            amount: fromFloorCharge,
        });
    }

    if (toFloorCharge > 0) {
        breakdown.push({
            key: "floor_to",
            label:
                "Этажи без лифта по второму адресу",
            amount: toFloorCharge,
        });
    }

    return {
        rawPrice:
            calloutPrice +
            vehicleCharge +
            helpersCharge +
            floorsCharge,

        breakdown,

        pricingModel: "hourly",
        billedHours,
        firstHourPrice,
        nextHourPrice,
        calloutPrice,
        vehicleHourlyRate,
        helperHourlyRate,
    };
}

/*
 * Межгород:
 *
 * подача машины
 * + километраж
 * + грузчики по часам
 * + этажи без лифта
 */
function calculateCargoIntercityPrice(
    config,
    details
) {
    const calloutPrice = Math.max(
        0,
        toFiniteNumber(
            config.calloutPrice
        )
    );

    const distanceKm = Math.max(
        0,
        toFiniteNumber(
            details.distanceKm
        )
    );

    const pricePerKm = Math.max(
        0,
        toFiniteNumber(
            config.pricePerKm
        )
    );

    const distanceCharge =
        distanceKm *
        pricePerKm;

    const helpersCount = Math.max(
        0,
        toFiniteNumber(
            details.helpersCount
        )
    );

    const helperHours = Math.max(
        helpersCount > 0 ? 1 : 0,
        toFiniteNumber(
            details.helperHours,
            helpersCount > 0 ? 1 : 0
        )
    );

    const helperHourlyRate = Math.max(
        0,
        toFiniteNumber(
            config.helperHourlyRate
        )
    );

    const helpersCharge =
        helpersCount *
        helperHours *
        helperHourlyRate;

    const {
        fromFloorCharge,
        toFloorCharge,
        total: floorsCharge,
    } = calculateTwoAddressFloorCharges(
        config,
        details
    );

    const breakdown = [];

    if (calloutPrice > 0) {
        breakdown.push({
            key: "vehicle_callout",
            label: "Подача машины",
            amount: calloutPrice,
        });
    }

    if (distanceCharge > 0) {
        breakdown.push({
            key: "distance",
            label:
                `Расстояние: ${distanceKm.toFixed(1)} км × ${pricePerKm} ₽`,
            amount: distanceCharge,
        });
    }

    if (helpersCharge > 0) {
        breakdown.push({
            key: "helpers_hours",
            label:
                `${helpersCount} грузчик(а) × ${helperHours} ч × ${helperHourlyRate} ₽`,
            amount: helpersCharge,
        });
    }

    if (fromFloorCharge > 0) {
        breakdown.push({
            key: "floor_from",
            label:
                "Этажи без лифта при погрузке",
            amount: fromFloorCharge,
        });
    }

    if (toFloorCharge > 0) {
        breakdown.push({
            key: "floor_to",
            label:
                "Этажи без лифта при выгрузке",
            amount: toFloorCharge,
        });
    }

    return {
        rawPrice:
            calloutPrice +
            distanceCharge +
            helpersCharge +
            floorsCharge,

        breakdown,

        pricingModel: "distance",
        distanceKm,
        pricePerKm,
        helperHourlyRate,
        helperHours,
    };
}

function calculateMovingPrice(
    config,
    details
) {
    const basePrice = Math.max(
        0,
        toFiniteNumber(config.basePrice)
    );

    const distanceKm = Math.max(
        0,
        toFiniteNumber(details.distanceKm)
    );

    const helpersCount = Math.max(
        0,
        toFiniteNumber(details.helpersCount)
    );

    const pricePerKm = Math.max(
        0,
        toFiniteNumber(config.pricePerKm)
    );

    const pricePerHelper = Math.max(
        0,
        toFiniteNumber(config.pricePerHelper)
    );

    const floorPrice = Math.max(
        0,
        toFiniteNumber(
            config.pricePerFloorWithoutElevator
        )
    );

    const distanceCharge =
        distanceKm * pricePerKm;

    const helpersCharge =
        helpersCount * pricePerHelper;

    const fromFloorCharge =
        calculateFloorCharge({
            floor: details.floorFrom,
            hasElevator:
            details.hasElevatorFrom,
            pricePerFloor: floorPrice,
        });

    const toFloorCharge =
        calculateFloorCharge({
            floor: details.floorTo,
            hasElevator:
            details.hasElevatorTo,
            pricePerFloor: floorPrice,
        });

    const breakdown = [];

    if (basePrice > 0) {
        breakdown.push({
            key: "base",
            label: "Базовая стоимость",
            amount: basePrice,
        });
    }

    if (distanceCharge > 0) {
        breakdown.push({
            key: "distance",
            label:
                `Расстояние: ${distanceKm.toFixed(1)} км`,
            amount: distanceCharge,
        });
    }

    if (helpersCharge > 0) {
        breakdown.push({
            key: "helpers",
            label:
                `Грузчики: ${helpersCount}`,
            amount: helpersCharge,
        });
    }

    if (fromFloorCharge > 0) {
        breakdown.push({
            key: "floor_from",
            label:
                "Подъём или спуск по первому адресу",
            amount: fromFloorCharge,
        });
    }

    if (toFloorCharge > 0) {
        breakdown.push({
            key: "floor_to",
            label:
                "Подъём или спуск по второму адресу",
            amount: toFloorCharge,
        });
    }

    return {
        rawPrice:
            basePrice +
            distanceCharge +
            helpersCharge +
            fromFloorCharge +
            toFloorCharge,

        breakdown,
    };
}

function calculateLoadersPrice(
    config,
    details
) {
    const helpersCount = Math.max(
        1,
        toFiniteNumber(
            details.helpersCount,
            1
        )
    );

    const requestedHours = Math.max(
        0,
        toFiniteNumber(
            details.estimatedHours
        )
    );

    const minimumHours = Math.max(
        1,
        toFiniteNumber(
            config.minimumHours,
            1
        )
    );

    const billedHours = Math.max(
        requestedHours,
        minimumHours
    );

    const pricePerHelperHour = Math.max(
        0,
        toFiniteNumber(
            config.pricePerHelperHour
        )
    );

    const hourlyTotal =
        helpersCount *
        pricePerHelperHour;

    const rawPrice =
        hourlyTotal *
        billedHours;

    return {
        rawPrice,

        breakdown: rawPrice > 0
            ? [
                {
                    key: "loaders",
                    label:
                        `${helpersCount} грузчик(а) × ${billedHours} ч × ${pricePerHelperHour} ₽`,
                    amount: rawPrice,
                },
            ]
            : [],

        pricingModel: "hourly",
        billedHours,
        firstHourPrice: hourlyTotal,
        nextHourPrice: hourlyTotal,
        helperHourlyRate:
        pricePerHelperHour,
    };
}

function calculateWasteRemovalPrice(
    config,
    details
) {
    const basePrice = Math.max(
        0,
        toFiniteNumber(config.basePrice)
    );

    const volumeType = String(
        details.estimatedVolume || "unknown"
    );

    const wasteType = String(
        details.wasteType || "other"
    );

    const volumeCharge = Math.max(
        0,
        getObjectPrice(
            config.volumePrices,
            volumeType
        )
    );

    const wasteTypeCharge = Math.max(
        0,
        getObjectPrice(
            config.wasteTypePrices,
            wasteType
        )
    );

    const loadingCharge =
        details.helpersRequired === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.loadingPrice
                )
            )
            : 0;

    const floor = Math.max(
        0,
        toFiniteNumber(details.floor)
    );

    const pricePerFloor = Math.max(
        0,
        toFiniteNumber(
            config.pricePerFloorWithoutElevator
        )
    );

    const floorCharge =
        details.hasElevator === true
            ? 0
            : floor * pricePerFloor;

    const breakdown = [];

    if (basePrice > 0) {
        breakdown.push({
            key: "base",
            label: "Базовая стоимость",
            amount: basePrice,
        });
    }

    if (volumeCharge > 0) {
        breakdown.push({
            key: "volume",
            label:
                WASTE_VOLUME_LABELS[volumeType] ||
                "Объём мусора",
            amount: volumeCharge,
        });
    }

    if (wasteTypeCharge > 0) {
        breakdown.push({
            key: "waste_type",
            label:
                WASTE_TYPE_LABELS[wasteType] ||
                "Тип мусора",
            amount: wasteTypeCharge,
        });
    }

    if (loadingCharge > 0) {
        breakdown.push({
            key: "loading",
            label: "Погрузка",
            amount: loadingCharge,
        });
    }

    if (floorCharge > 0) {
        breakdown.push({
            key: "floor",
            label:
                `Этаж без лифта: ${floor}`,
            amount: floorCharge,
        });
    }

    return {
        rawPrice:
            basePrice +
            volumeCharge +
            wasteTypeCharge +
            loadingCharge +
            floorCharge,

        breakdown,
    };
}

function calculateCleaningPrice(
    config,
    details
) {
    const cleaningType = String(
        details.cleaningType || "regular"
    );

    const areaSqm = Math.max(
        0,
        toFiniteNumber(details.areaSqm)
    );

    const pricePerSqm = Math.max(
        0,
        getObjectPrice(
            config.pricePerSqm,
            cleaningType
        )
    );

    const areaCharge =
        areaSqm * pricePerSqm;

    const windowsCharge =
        details.windowsCleaning === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.windowsCleaningPrice
                )
            )
            : 0;

    const breakdown = [];

    if (areaCharge > 0) {
        breakdown.push({
            key: "area",
            label:
                `${areaSqm} м² × ${pricePerSqm} ₽`,
            amount: areaCharge,
        });
    }

    if (windowsCharge > 0) {
        breakdown.push({
            key: "windows",
            label: "Мытьё окон",
            amount: windowsCharge,
        });
    }

    return {
        rawPrice:
            areaCharge +
            windowsCharge,

        breakdown,
    };
}

function calculateApplianceRepairPrice(
    config,
    details
) {
    const applianceType = String(
        details.applianceType || "other"
    );

    const repairBasePrice = Math.max(
        0,
        getObjectPrice(
            config.applianceBasePrices,
            applianceType
        )
    );

    const diagnosticVisitPrice = Math.max(
        0,
        toFiniteNumber(
            config.diagnosticVisitPrice
        )
    );

    const breakdown = [];

    if (repairBasePrice > 0) {
        breakdown.push({
            key: "repair",
            label:
                APPLIANCE_TYPE_LABELS[
                    applianceType
                    ] ||
                "Ориентировочная стоимость ремонта",
            amount: repairBasePrice,
        });
    }

    if (diagnosticVisitPrice > 0) {
        breakdown.push({
            key: "diagnostics",
            label: "Диагностика и выезд",
            amount: diagnosticVisitPrice,
        });
    }

    return {
        rawPrice:
            repairBasePrice +
            diagnosticVisitPrice,

        breakdown,
    };
}

function calculateHourlyServicePrice(
    config,
    details
) {
    const visitPrice = Math.max(
        0,
        toFiniteNumber(config.visitPrice)
    );

    const hourlyRate = Math.max(
        0,
        toFiniteNumber(config.hourlyRate)
    );

    const requestedHours = Math.max(
        0,
        toFiniteNumber(
            details.estimatedHours
        )
    );

    const minimumHours = Math.max(
        1,
        toFiniteNumber(
            config.minimumHours,
            1
        )
    );

    const billedHours = Math.max(
        requestedHours,
        minimumHours
    );

    const hoursCharge =
        billedHours * hourlyRate;

    const complexity = String(
        details.complexity || "unknown"
    );

    const complexityCharge = Math.max(
        0,
        getObjectPrice(
            config.complexityPrices,
            complexity
        )
    );

    const workType = String(
        details.workType || "other"
    );

    const workTypeCharge = Math.max(
        0,
        getObjectPrice(
            config.workTypePrices,
            workType
        )
    );

    const pointsCount = Math.max(
        0,
        toFiniteNumber(details.pointsCount)
    );

    const pointsCharge =
        pointsCount *
        Math.max(
            0,
            toFiniteNumber(
                config.pricePerPoint
            )
        );

    const tasksCount = Math.max(
        0,
        toFiniteNumber(details.tasksCount)
    );

    const tasksCharge =
        tasksCount *
        Math.max(
            0,
            toFiniteNumber(
                config.pricePerTask
            )
        );

    const materialsCharge =
        details.materialsRequired === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.materialsPurchaseFee
                )
            )
            : 0;

    const breakdown = [];

    if (visitPrice > 0) {
        breakdown.push({
            key: "visit",
            label: "Выезд мастера",
            amount: visitPrice,
        });
    }

    if (hoursCharge > 0) {
        breakdown.push({
            key: "hours",
            label:
                `${billedHours} ч × ${hourlyRate} ₽`,
            amount: hoursCharge,
        });
    }

    if (workTypeCharge > 0) {
        breakdown.push({
            key: "work_type",
            label:
                HOURLY_WORK_TYPE_LABELS[
                    workType
                    ] ||
                "Тип работы",
            amount: workTypeCharge,
        });
    }

    if (complexityCharge > 0) {
        breakdown.push({
            key: "complexity",
            label:
                COMPLEXITY_LABELS[
                    complexity
                    ] ||
                "Сложность работы",
            amount: complexityCharge,
        });
    }

    if (pointsCharge > 0) {
        breakdown.push({
            key: "points",
            label:
                `Количество точек: ${pointsCount}`,
            amount: pointsCharge,
        });
    }

    if (tasksCharge > 0) {
        breakdown.push({
            key: "tasks",
            label:
                `Количество задач: ${tasksCount}`,
            amount: tasksCharge,
        });
    }

    if (materialsCharge > 0) {
        breakdown.push({
            key: "materials",
            label: "Покупка материалов",
            amount: materialsCharge,
        });
    }

    return {
        rawPrice:
            visitPrice +
            hoursCharge +
            workTypeCharge +
            complexityCharge +
            pointsCharge +
            tasksCharge +
            materialsCharge,

        breakdown,
    };
}

function calculateAirConditionerPrice(
    config,
    details
) {
    const visitPrice = Math.max(
        0,
        toFiniteNumber(config.visitPrice)
    );

    const workType = String(
        details.workType || "other"
    );

    const unitsCount = Math.max(
        1,
        toFiniteNumber(
            details.unitsCount,
            1
        )
    );

    const unitPrice = Math.max(
        0,
        getObjectPrice(
            config.workTypePrices,
            workType
        )
    );

    const workCharge =
        unitsCount * unitPrice;

    const difficultAccessCharge =
        details.difficultAccess === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.difficultAccessPrice
                )
            )
            : 0;

    const materialsCharge =
        details.materialsRequired === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.materialsReservePrice
                )
            )
            : 0;

    const breakdown = [];

    if (visitPrice > 0) {
        breakdown.push({
            key: "visit",
            label: "Выезд специалиста",
            amount: visitPrice,
        });
    }

    if (workCharge > 0) {
        breakdown.push({
            key: "work",
            label:
                `${
                    AIR_CONDITIONER_WORK_LABELS[
                        workType
                        ] ||
                    "Работа с кондиционером"
                }: ${unitsCount}`,
            amount: workCharge,
        });
    }

    if (difficultAccessCharge > 0) {
        breakdown.push({
            key: "difficult_access",
            label:
                "Сложный доступ к наружному блоку",
            amount: difficultAccessCharge,
        });
    }

    if (materialsCharge > 0) {
        breakdown.push({
            key: "materials",
            label:
                "Резерв на дополнительные материалы",
            amount: materialsCharge,
        });
    }

    return {
        rawPrice:
            visitPrice +
            workCharge +
            difficultAccessCharge +
            materialsCharge,

        breakdown,
    };
}

function calculateFixedServicePrice(
    config,
    details
) {
    const visitPrice = Math.max(
        0,
        toFiniteNumber(config.visitPrice)
    );

    const workType = String(
        details.workType || "other"
    );

    const workTypeCharge = Math.max(
        0,
        getObjectPrice(
            config.workTypePrices,
            workType
        )
    );

    const complexity = String(
        details.complexity || "unknown"
    );

    const complexityCharge = Math.max(
        0,
        getObjectPrice(
            config.complexityPrices,
            complexity
        )
    );

    const quantityField = String(
        config.quantityField || ""
    );

    const quantity = quantityField
        ? Math.max(
            0,
            toFiniteNumber(
                details[quantityField]
            )
        )
        : 0;

    const pricePerUnit = Math.max(
        0,
        toFiniteNumber(
            config.pricePerUnit
        )
    );

    const quantityCharge =
        quantity * pricePerUnit;

    const emergencyCharge =
        details.isEmergency === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.emergencyPrice
                )
            )
            : 0;

    const materialsCharge =
        details.materialsRequired === true
            ? Math.max(
                0,
                toFiniteNumber(
                    config.materialsPurchaseFee
                )
            )
            : 0;

    const breakdown = [];

    if (visitPrice > 0) {
        breakdown.push({
            key: "visit",
            label: "Выезд специалиста",
            amount: visitPrice,
        });
    }

    if (workTypeCharge > 0) {
        breakdown.push({
            key: "work_type",
            label: "Тип работы",
            amount: workTypeCharge,
        });
    }

    if (complexityCharge > 0) {
        breakdown.push({
            key: "complexity",
            label:
                COMPLEXITY_LABELS[complexity] ||
                "Сложность работы",
            amount: complexityCharge,
        });
    }

    if (quantityCharge > 0) {
        breakdown.push({
            key: "quantity",
            label:
                `${config.quantityLabel || "Количество"}: ${quantity}`,
            amount: quantityCharge,
        });
    }

    if (emergencyCharge > 0) {
        breakdown.push({
            key: "emergency",
            label: "Срочный выезд",
            amount: emergencyCharge,
        });
    }

    if (materialsCharge > 0) {
        breakdown.push({
            key: "materials",
            label: "Покупка материалов",
            amount: materialsCharge,
        });
    }

    return {
        rawPrice:
            visitPrice +
            workTypeCharge +
            complexityCharge +
            quantityCharge +
            emergencyCharge +
            materialsCharge,

        breakdown,
    };
}

function hasValidRequiredDetails(
    calculator,
    details
) {
    switch (calculator) {
        case "cargo_hourly":
            return (
                Number.isFinite(
                    Number(
                        details.estimatedHours
                    )
                ) &&
                Number(
                    details.estimatedHours
                ) > 0
            );

        case "cargo_intercity":
            return (
                Number.isFinite(
                    Number(details.distanceKm)
                ) &&
                Number(details.distanceKm) >= 0
            );

        /*
         * Оставляем поддержку старых конфигураций,
         * пока база полностью не обновлена.
         */
        case "moving":
        case "large_delivery":
            return (
                Number.isFinite(
                    Number(details.distanceKm)
                ) &&
                Number(details.distanceKm) >= 0
            );

        case "loaders":
            return (
                Number.isFinite(
                    Number(details.helpersCount)
                ) &&
                Number(details.helpersCount) > 0 &&
                Number.isFinite(
                    Number(
                        details.estimatedHours
                    )
                ) &&
                Number(
                    details.estimatedHours
                ) > 0
            );

        case "cleaning":
            return (
                Number.isFinite(
                    Number(details.areaSqm)
                ) &&
                Number(details.areaSqm) > 0 &&
                !!details.cleaningType
            );

        case "waste_removal":
            return !!details.wasteType;

        case "appliance_repair":
            return !!details.applianceType;

        case "hourly_service": {
            const hasTasks =
                Number.isFinite(
                    Number(details.tasksCount)
                ) &&
                Number(details.tasksCount) > 0;

            return (
                !!details.complexity &&
                (
                    !!details.workType ||
                    hasTasks
                )
            );
        }

        case "air_conditioner":
            return (
                !!details.workType &&
                Number.isFinite(
                    Number(details.unitsCount)
                ) &&
                Number(details.unitsCount) > 0
            );

        case "fixed_service":
            return (
                !!details.workType &&
                !!details.complexity
            );

        case "sewer_cleaning":
            return (
                !!details.blockageType &&
                !!details.complexity
            );

        default:
            return false;
    }
}

export function calculateRecommendedPrice({
                                              pricingConfig,
                                              serviceDetails,
                                          }) {
    if (
        !pricingConfig ||
        (
            pricingConfig.enabled !== true &&
            pricingConfig.enabled !== 1
        )
    ) {
        return null;
    }

    const calculator =
        String(
            pricingConfig.calculator || ""
        );

    const details =
        serviceDetails || {};

    if (
        !hasValidRequiredDetails(
            calculator,
            details
        )
    ) {
        return null;
    }

    let calculation = null;

    switch (calculator) {
        case "cargo_hourly":
            calculation =
                calculateCargoHourlyPrice(
                    pricingConfig,
                    details
                );
            break;

        case "cargo_intercity":
            calculation =
                calculateCargoIntercityPrice(
                    pricingConfig,
                    details
                );
            break;

        /*
         * Временная обратная совместимость.
         * После обновления базы новые заказы сюда
         * попадать уже не должны.
         */
        case "moving":
        case "large_delivery":
            calculation =
                calculateMovingPrice(
                    pricingConfig,
                    details
                );
            break;

        case "loaders":
            calculation =
                calculateLoadersPrice(
                    pricingConfig,
                    details
                );
            break;

        case "waste_removal":
            calculation =
                calculateWasteRemovalPrice(
                    pricingConfig,
                    details
                );
            break;

        case "cleaning":
            calculation =
                calculateCleaningPrice(
                    pricingConfig,
                    details
                );
            break;

        case "appliance_repair":
            calculation =
                calculateApplianceRepairPrice(
                    pricingConfig,
                    details
                );
            break;

        case "hourly_service":
            calculation =
                calculateHourlyServicePrice(
                    pricingConfig,
                    details
                );
            break;

        case "air_conditioner":
            calculation =
                calculateAirConditionerPrice(
                    pricingConfig,
                    details
                );
            break;

        case "fixed_service":
            calculation =
                calculateFixedServicePrice(
                    pricingConfig,
                    details
                );
            break;

        case "sewer_cleaning":
            calculation =
                calculateSewerCleaningPrice(
                    pricingConfig,
                    details
                );
            break;

        default:
            return null;
    }

    const rawPrice =
        Number(calculation?.rawPrice);

    const breakdown =
        Array.isArray(
            calculation?.breakdown
        )
            ? calculation.breakdown
            : [];

    if (
        !Number.isFinite(rawPrice) ||
        rawPrice < 0
    ) {
        return null;
    }

    const minimumPrice = Math.max(
        0,
        toFiniteNumber(
            pricingConfig.minimumPrice
        )
    );

    const maximumPrice = Math.max(
        minimumPrice,
        toFiniteNumber(
            pricingConfig.maximumPrice,
            300000
        )
    );

    const roundedPrice =
        Math.round(rawPrice / 100) * 100;

    const recommendedPrice =
        clamp(
            roundedPrice,
            minimumPrice,
            maximumPrice
        );

    const rangePercent = Math.max(
        0,
        toFiniteNumber(
            pricingConfig.rangePercent
        )
    );

    const calculatedMinPrice =
        Math.round(
            (
                recommendedPrice *
                (1 - rangePercent / 100)
            ) / 100
        ) * 100;

    const calculatedMaxPrice =
        Math.round(
            (
                recommendedPrice *
                (1 + rangePercent / 100)
            ) / 100
        ) * 100;

    return {
        recommendedPrice,

        minPrice: clamp(
            calculatedMinPrice,
            minimumPrice,
            maximumPrice
        ),

        maxPrice: clamp(
            calculatedMaxPrice,
            minimumPrice,
            maximumPrice
        ),

        calculator,
        breakdown,

        pricingModel:
            calculation?.pricingModel ||
            pricingConfig.pricingModel ||
            "fixed",

        billedHours:
            Number.isFinite(
                Number(calculation?.billedHours)
            )
                ? Number(
                    calculation.billedHours
                )
                : null,

        firstHourPrice:
            Number.isFinite(
                Number(
                    calculation?.firstHourPrice
                )
            )
                ? Math.round(
                    Number(
                        calculation.firstHourPrice
                    )
                )
                : null,

        nextHourPrice:
            Number.isFinite(
                Number(
                    calculation?.nextHourPrice
                )
            )
                ? Math.round(
                    Number(
                        calculation.nextHourPrice
                    )
                )
                : null,

        calloutPrice:
            Number.isFinite(
                Number(
                    calculation?.calloutPrice
                )
            )
                ? Number(
                    calculation.calloutPrice
                )
                : null,

        vehicleHourlyRate:
            Number.isFinite(
                Number(
                    calculation?.vehicleHourlyRate
                )
            )
                ? Number(
                    calculation.vehicleHourlyRate
                )
                : null,

        helperHourlyRate:
            Number.isFinite(
                Number(
                    calculation?.helperHourlyRate
                )
            )
                ? Number(
                    calculation.helperHourlyRate
                )
                : null,

        configVersion:
            toFiniteNumber(
                pricingConfig.version,
                1
            ),
    };
}