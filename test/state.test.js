const test = require("node:test");
const assert = require("node:assert/strict");
const { clampPercent, createInitialState, resolveInterlocks } = require("../src/state");

test("cria o estado inicial desconectado", () => {
    const state = createInitialState({ appVersion: "1.0.0-beta", canShutdown: true });

    assert.equal(state.connected, false);
    assert.equal(state.plcReady, false);
    assert.equal(state.plcStatus, "checking");
    assert.equal(state.appVersion, "1.0.0-beta");
    assert.equal(state.canShutdown, true);
    assert.equal(state.fillPercent, 0);
    assert.equal(state.total, 0);
});

test("limita o percentual de envase entre 0 e 100", () => {
    assert.equal(clampPercent(-10), 0);
    assert.equal(clampPercent(0), 0);
    assert.equal(clampPercent(45), 45);
    assert.equal(clampPercent(100), 100);
    assert.equal(clampPercent(140), 100);
    assert.equal(clampPercent("72"), 72);
});

test("bloqueia a EV sem garrafa posicionada", () => {
    const result = resolveInterlocks({
        evOn: true,
        bottlePositioned: false,
        atOn: false,
        sensorS2: false
    });

    assert.equal(result.evBlocked, true);
    assert.equal(result.evOn, false);
});

test("libera a EV com garrafa posicionada", () => {
    const result = resolveInterlocks({
        evOn: true,
        bottlePositioned: true,
        atOn: false,
        sensorS2: false
    });

    assert.equal(result.evBlocked, false);
    assert.equal(result.evOn, true);
});

test("bloqueia a AT sem garrafa em S2", () => {
    const result = resolveInterlocks({
        evOn: false,
        bottlePositioned: false,
        atOn: true,
        sensorS2: false
    });

    assert.equal(result.atBlocked, true);
    assert.equal(result.atOn, false);
});

test("libera a AT com garrafa em S2", () => {
    const result = resolveInterlocks({
        evOn: false,
        bottlePositioned: false,
        atOn: true,
        sensorS2: true
    });

    assert.equal(result.atBlocked, false);
    assert.equal(result.atOn, true);
});
