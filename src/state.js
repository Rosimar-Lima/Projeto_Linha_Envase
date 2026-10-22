function createInitialState({ appVersion = "", canShutdown = false } = {}) {
    return {
        connected: false,
        plcReady: false,
        plcStatus: "checking",
        runtimeState: "Indisponível",
        appVersion,
        plcVersion: "",
        running: false,
        sensorS1: false,
        sensorS2: false,
        bottlePositioned: false,
        conveyorOn: false,
        evOn: false,
        evBlocked: false,
        atOn: false,
        atBlocked: false,
        fillPercent: 0,
        filled: 0,
        capped: 0,
        total: 0,
        canShutdown
    };
}

function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value)));
}

function resolveInterlocks({ evOn, bottlePositioned, atOn, sensorS2 }) {
    const evOnRequested = Boolean(evOn);
    const atOnRequested = Boolean(atOn);
    const bottlePositionedValue = Boolean(bottlePositioned);
    const sensorS2Value = Boolean(sensorS2);

    return {
        bottlePositioned: bottlePositionedValue,
        sensorS2: sensorS2Value,
        evBlocked: evOnRequested && !bottlePositionedValue,
        evOn: evOnRequested && bottlePositionedValue,
        atBlocked: atOnRequested && !sensorS2Value,
        atOn: atOnRequested && sensorS2Value
    };
}

module.exports = {
    clampPercent,
    createInitialState,
    resolveInterlocks
};
