const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SYMBOLS = Object.freeze([
    "start", "stop", "reset", "running", "sensorS1", "sensorS2",
    "bottlePositioned", "conveyorOn", "evOn", "atOn", "fillPercent",
    "filled", "capped"
]);

const DEFAULTS = Object.freeze({
    host: "127.0.0.1",
    port: 3000,
    targetAdsPort: 851,
    timeoutMs: 5000,
    recreateAfterMs: 15000,
    pollIntervalMs: 200,
    pulseMs: 120
});

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Falha ao carregar ${label}: ${error.message}`);
    }
}

function toNumber(value, fallback, label) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} inválido: ${value}`);
    return number;
}

function loadPlcConfig(rootDir, env) {
    const fileConfig = readJson(path.join(rootDir, "plc.config.json"), "plc.config.json");
    const connection = fileConfig.connection || {};
    const command = fileConfig.command || {};
    const symbols = fileConfig.symbols || {};

    const missingSymbols = REQUIRED_SYMBOLS.filter(key => typeof symbols[key] !== "string" || !symbols[key].trim());
    if (missingSymbols.length) {
        throw new Error(`plc.config.json sem símbolos obrigatórios: ${missingSymbols.join(", ")}`);
    }
    if (!connection.targetAmsNetId) {
        throw new Error("plc.config.json sem connection.targetAmsNetId.");
    }

    const targetAmsNetId = String(env.ADS_TARGET_AMS_NET_ID || connection.targetAmsNetId).trim();
    if (!targetAmsNetId) {
        throw new Error("ADS_TARGET_AMS_NET_ID inválido.");
    }

    return {
        targetAmsNetId,
        targetAdsPort: toNumber(
            env.ADS_TARGET_PORT || connection.targetAdsPort || DEFAULTS.targetAdsPort,
            DEFAULTS.targetAdsPort,
            "ADS_TARGET_PORT"
        ),
        timeoutMs: toNumber(
            env.ADS_TIMEOUT_MS || connection.timeoutMs || DEFAULTS.timeoutMs,
            DEFAULTS.timeoutMs,
            "ADS_TIMEOUT_MS"
        ),
        recreateAfterMs: toNumber(
            env.ADS_RECREATE_AFTER_MS || connection.recreateAfterMs || DEFAULTS.recreateAfterMs,
            DEFAULTS.recreateAfterMs,
            "ADS_RECREATE_AFTER_MS"
        ),
        pollIntervalMs: toNumber(
            env.ADS_POLL_INTERVAL_MS || connection.pollIntervalMs || DEFAULTS.pollIntervalMs,
            DEFAULTS.pollIntervalMs,
            "ADS_POLL_INTERVAL_MS"
        ),
        pulseMs: toNumber(command.pulseMs || DEFAULTS.pulseMs, DEFAULTS.pulseMs, "command.pulseMs"),
        symbols
    };
}

function loadAppVersion(rootDir, env) {
    if (env.APP_VERSION) return String(env.APP_VERSION).trim();
    try {
        const packageJson = readJson(path.join(rootDir, "package.json"), "package.json");
        return String(packageJson.version || "").trim();
    } catch (error) {
        console.warn(`Falha ao ler a versão em package.json: ${error.message}`);
        return "";
    }
}

function loadConfig(rootDir, env = process.env) {
    return {
        server: {
            host: env.HOST || DEFAULTS.host,
            port: toNumber(env.PORT, DEFAULTS.port, "PORT")
        },
        plc: loadPlcConfig(rootDir, env),
        appVersion: loadAppVersion(rootDir, env)
    };
}

module.exports = {
    REQUIRED_SYMBOLS,
    loadAppVersion,
    loadConfig,
    loadPlcConfig
};
