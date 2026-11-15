
"use strict";

function isFutureTimestamp(value, now = Date.now()) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return false;
    }

    const timestamp = new Date(value).getTime();

    return (
        Number.isFinite(timestamp) &&
        Number.isFinite(now) &&
        timestamp > now
    );
}

module.exports = {
    isFutureTimestamp,
};
