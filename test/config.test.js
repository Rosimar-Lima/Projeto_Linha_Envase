const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig, loadPlcConfig } = require("../src/config");

const SYMBOLS = Object.freeze({
    start: "GVL_HMI.bCmdStart",
    stop: "GVL_HMI.bCmdStop",
    reset: "GVL_HMI.bCmdReset",
    running: "GVL_HMI.bRunning",
    sensorS1: "GVL_HMI.bSensorS1",
    sensorS2: "GVL_HMI.bSensorS2",
    bottlePositioned: "GVL_HMI.bBottlePositioned",
    conveyorOn: "GVL_HMI.bConveyorOn",
    evOn: "GVL_HMI.bEvOn",
    atOn: "GVL_HMI.bAtOn",
    fillPercent: "GVL_HMI.nFillPercent",
    filled: "GVL_HMI.nBottlesFilled",
    capped: "GVL_HMI.nBottlesCapped"
});

function createProject(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "linha-envase-"));
    const config = {
        connection: {
            targetAmsNetId: "39.90.64.65.1.1",
            targetAdsPort: 851,
            timeoutMs: 5000,
            recreateAfterMs: 15000,
            pollIntervalMs: 200
        },
        command: { pulseMs: 120 },
        symbols: { ...SYMBOLS },
        ...overrides
    };
    fs.writeFileSync(path.join(root, "plc.config.json"), JSON.stringify(config));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    return root;
}

test("carrega os valores padrão do projeto", t => {
    const root = createProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const config = loadConfig(root, {});

    assert.deepEqual(config.server, { host: "127.0.0.1", port: 3000 });
    assert.equal(config.plc.targetAmsNetId, "39.90.64.65.1.1");
    assert.equal(config.plc.targetAdsPort, 851);
    assert.equal(config.plc.pollIntervalMs, 200);
    assert.equal(config.plc.pulseMs, 120);
    assert.equal(config.appVersion, "1.2.3");
});

test("aplica variáveis de ambiente sobre o arquivo", t => {
    const root = createProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const config = loadConfig(root, {
        HOST: "0.0.0.0",
        PORT: "4000",
        ADS_TARGET_AMS_NET_ID: "10.0.0.1.1.1",
        ADS_TARGET_PORT: "852",
        ADS_TIMEOUT_MS: "1500",
        ADS_RECREATE_AFTER_MS: "3000",
        ADS_POLL_INTERVAL_MS: "50",
        APP_VERSION: "2.0.0"
    });

    assert.deepEqual(config.server, { host: "0.0.0.0", port: 4000 });
    assert.equal(config.plc.targetAmsNetId, "10.0.0.1.1.1");
    assert.equal(config.plc.targetAdsPort, 852);
    assert.equal(config.plc.timeoutMs, 1500);
    assert.equal(config.plc.recreateAfterMs, 3000);
    assert.equal(config.plc.pollIntervalMs, 50);
    assert.equal(config.appVersion, "2.0.0");
});

test("rejeita números inválidos na configuração", t => {
    const root = createProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.throws(() => loadConfig(root, { PORT: "abc" }), /PORT inválido/);
    assert.throws(() => loadConfig(root, { ADS_POLL_INTERVAL_MS: "rápido" }), /ADS_POLL_INTERVAL_MS inválido/);
});

test("rejeita símbolos obrigatórios ausentes", t => {
    const root = createProject({ symbols: { ...SYMBOLS, start: "" } });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.throws(() => loadPlcConfig(root, {}), /símbolos obrigatórios: start/);
});

test("rejeita configuração de conexão sem AMS Net ID", t => {
    const root = createProject({
        connection: { targetAmsNetId: "", targetAdsPort: 851 }
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.throws(() => loadPlcConfig(root, {}), /connection\.targetAmsNetId/);
});

test("mantém a versão vazia quando package.json não existe", t => {
    const root = createProject();
    fs.rmSync(path.join(root, "package.json"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(loadConfig(root, {}).appVersion, "");
    } finally {
        console.warn = originalWarn;
    }
});
