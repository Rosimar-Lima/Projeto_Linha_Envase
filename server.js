require("dotenv").config();

const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { Client } = require("ads-client");

const config = {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3000),
    targetAmsNetId: process.env.ADS_TARGET_AMS_NET_ID || "39.90.64.65.1.1",
    targetAdsPort: Number(process.env.ADS_TARGET_PORT || 851)
};

const ADS_RECREATE_AFTER_MS = Number(process.env.ADS_RECREATE_AFTER_MS || 15000);
// Intervalo de leitura do PLC. Precisa ser bem menor que a menor etapa do ciclo
// (step1 = 0,46 s) para a IHM acompanhar a esteira sem atraso perceptível.
const ADS_POLL_INTERVAL_MS = Number(process.env.ADS_POLL_INTERVAL_MS || 200);

const symbols = {
    start: "GVL_HMI.bCmdStart",
    stop: "GVL_HMI.bCmdStop",
    reset: "GVL_HMI.bCmdReset",
    running: "GVL_HMI.bRunning",
    sensorS1: "GVL_HMI.bSensorS1",
    bottlePositioned: "GVL_HMI.bBottlePositioned",
    conveyorOn: "GVL_HMI.bConveyorOn",
    evOn: "GVL_HMI.bEvOn",
    atOn: "GVL_HMI.bAtOn",
    fillPercent: "GVL_HMI.nFillPercent",
    filled: "GVL_HMI.nBottlesFilled",
    capped: "GVL_HMI.nBottlesCapped",
    total: "GVL_HMI.nProductionTotal"
};

const app = express();
const server = http.createServer(app);
const sockets = new WebSocketServer({ server });
const webAppPath = path.join(__dirname, "WebApp");

let adsClient;
let adsConnected = false;
let adsConnecting = false;
let nextAdsRetryAt = 0;
let adsLostAt = 0;
let commandInProgress = false;
let plcStateReadInProgress = false;
let adsWriteInProgress = false;
let adsWriteQueue = Promise.resolve();
let lastEvBlocked = false;
let lastState = {
    connected: false,
    plcReady: false,
    plcStatus: "checking",
    runtimeState: "Indisponível",
    running: false,
    sensorS1: false,
    bottlePositioned: false,
    conveyorOn: false,
    evOn: false,
    evBlocked: false,
    atOn: false,
    fillPercent: 0,
    filled: 0,
    capped: 0,
    total: 0
};

app.use(express.static(webAppPath));

function publishState(state) {
    lastState = state;
    const message = JSON.stringify({ type: "state", ...state });
    for (const socket of sockets.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
}

async function connectAds() {
    if (adsConnecting) return false;
    if (adsClient && adsClient.connection.connected) return true;
    if (Date.now() < nextAdsRetryAt) return false;
    if (adsClient) {
        if (adsLostAt === 0) adsLostAt = Date.now();
        if (Date.now() - adsLostAt < ADS_RECREATE_AFTER_MS) return false;
        await adsClient.disconnect().catch(() => {});
        adsClient = undefined;
        adsLostAt = 0;
    }
    adsConnecting = true;
    const client = new Client({
        targetAmsNetId: config.targetAmsNetId,
        targetAdsPort: config.targetAdsPort,
        timeoutDelay: Number(process.env.ADS_TIMEOUT_MS || 5000),
        autoReconnect: true
    });
    adsClient = client;

    client.on("connectionLost", () => {
        if (adsClient !== client) return;
        adsConnected = false;
        adsLostAt = Date.now();
        publishState({ ...lastState, connected: false, plcReady: false, plcStatus: "offline", running: false });
        console.warn("Conexão ADS perdida; aguardando reconexão automática.");
    });
    client.on("reconnect", () => {
        if (adsClient !== client) return;
        adsConnected = true;
        nextAdsRetryAt = 0;
        adsLostAt = 0;
        publishState({ ...lastState, connected: true, plcReady: false, plcStatus: "checking", running: false });
        console.log(`ADS reconectado: ${config.targetAmsNetId}:${config.targetAdsPort}`);
    });

    try {
        await client.connect();
        adsConnected = Boolean(client.connection.connected);
        nextAdsRetryAt = 0;
        adsLostAt = 0;
        publishState({ ...lastState, connected: adsConnected, plcReady: false, plcStatus: "checking", running: false });
        console.log(`ADS conectado: ${config.targetAmsNetId}:${config.targetAdsPort}`);
        try {
            await client.cacheSymbols();
            await client.cacheDataTypes();
        } catch (error) {
            console.warn(`Cache ADS indisponível; leituras sob demanda: ${error.message}`);
        }
        return adsConnected;
    } catch (error) {
        await client.disconnect().catch(() => {});
        if (adsClient === client) {
            adsClient = undefined;
            adsConnected = false;
        }
        nextAdsRetryAt = Date.now() + 5000;
        publishState({ ...lastState, connected: false, plcReady: false, plcStatus: "offline", running: false });
        console.error(`ADS indisponível: ${error.message}`);
        return false;
    } finally {
        adsConnecting = false;
    }
}

async function readPlcState() {
    if (plcStateReadInProgress || commandInProgress || adsWriteInProgress) return;
    plcStateReadInProgress = true;

    try {
        if (!(await connectAds())) return;

        const runtime = await adsClient.readState();
        if (runtime.adsStateStr !== "Run") {
            publishState({
                ...lastState,
                connected: true,
                plcReady: false,
                plcStatus: "stopped",
                runtimeState: runtime.adsStateStr,
                running: false
            });
            return;
        }

        const running = await adsClient.readValue(symbols.running);
        const sensorS1 = await adsClient.readValue(symbols.sensorS1);
        const bottlePositioned = await adsClient.readValue(symbols.bottlePositioned);
        const conveyorOn = await adsClient.readValue(symbols.conveyorOn);
        const evOn = await adsClient.readValue(symbols.evOn);
        const atOn = await adsClient.readValue(symbols.atOn);
        const fillPercent = await adsClient.readValue(symbols.fillPercent);
        const filled = await adsClient.readValue(symbols.filled);
        const capped = await adsClient.readValue(symbols.capped);
        const total = await adsClient.readValue(symbols.total);

        const bottlePositionedValue = Boolean(bottlePositioned.value);
        const evOnRequested = Boolean(evOn.value);

        // Regra de intertravamento: a EV so atua com a garrafa sob ela.
        // A ponte nunca publica evOn=true sem bottlePositioned=true.
        const evBlocked = evOnRequested && !bottlePositionedValue;
        const safeEvOn = evOnRequested && bottlePositionedValue;
        if (evBlocked !== lastEvBlocked) {
            lastEvBlocked = evBlocked;
            if (evBlocked) console.warn("Intertravamento EV: pedido de envase sem garrafa posicionada; EV bloqueada.");
        }

        publishState({
            connected: true,
            plcReady: true,
            plcStatus: "ready",
            runtimeState: runtime.adsStateStr,
            running: Boolean(running.value),
            sensorS1: Boolean(sensorS1.value),
            bottlePositioned: bottlePositionedValue,
            conveyorOn: Boolean(conveyorOn.value),
            evOn: safeEvOn,
            evBlocked,
            atOn: Boolean(atOn.value),
            fillPercent: Math.max(0, Math.min(100, Number(fillPercent.value))),
            filled: Number(filled.value),
            capped: Number(capped.value),
            total: Number(total.value)
        });
    } catch (error) {
        adsConnected = Boolean(adsClient?.connection.connected);
        publishState({
            ...lastState,
            connected: adsConnected,
            plcReady: false,
            plcStatus: adsConnected ? "fault" : "offline",
            running: false
        });
        console.error(`Falha ao ler o PLC: ${error.message}`);
    } finally {
        plcStateReadInProgress = false;
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function queueAdsWrite(write) {
    const queuedWrite = adsWriteQueue.then(async () => {
        while (plcStateReadInProgress) await delay(10);
        adsWriteInProgress = true;
        try {
            if (!(await connectAds())) throw new Error("PLC TwinCAT não conectado via ADS.");
            await write(adsClient);
        } finally {
            adsWriteInProgress = false;
        }
    });
    adsWriteQueue = queuedWrite.catch(() => {});
    return queuedWrite;
}

async function pulseCommand(command) {
    const symbol = symbols[command];
    if (!symbol) throw new Error("Comando desconhecido.");

    return queueAdsWrite(async client => {
        if (commandInProgress) throw new Error("Aguarde o comando atual terminar.");
        commandInProgress = true;
        let commandMayBeActive = false;
        try {
            const runtime = await client.readState();
            if (runtime.adsStateStr !== "Run") {
                throw new Error(`PLC em ${runtime.adsStateStr}; coloque o runtime em Run para enviar comandos.`);
            }

            if (command === "reset") {
                const running = await client.readValue(symbols.running);
                if (running.value) throw new Error("Desligue a linha antes de zerar os contadores.");
            }

            commandMayBeActive = true;
            await client.writeValue(symbol, true);
            await delay(120);
            await client.writeValue(symbol, false);
        } finally {
            if (commandMayBeActive && adsConnected) await client.writeValue(symbol, false).catch(() => {});
            commandInProgress = false;
        }
    });
}

sockets.on("connection", socket => {
    socket.send(JSON.stringify({ type: "state", ...lastState }));
    socket.on("message", async data => {
        let message;
        try {
            message = JSON.parse(data.toString());
            if (message.type !== "command" || !["start", "stop", "reset"].includes(message.command)) {
                throw new Error("Mensagem inválida.");
            }
            await pulseCommand(message.command);
            await readPlcState();
            socket.send(JSON.stringify({ type: "commandResult", command: message.command }));
        } catch (error) {
            socket.send(JSON.stringify({ type: "error", message: error.message }));
        }
    });
});

const stateInterval = setInterval(readPlcState, ADS_POLL_INTERVAL_MS);

server.listen(config.port, config.host, () => {
    console.log(`IHM disponível em http://${config.host}:${config.port}`);
    console.log(`Rota TwinCAT local -> ${config.targetAmsNetId}:${config.targetAdsPort}`);
});

async function shutdown(signal) {
    console.log(`Encerrando IHM (${signal})...`);
    clearInterval(stateInterval);
    for (const socket of sockets.clients) socket.close();
    if (adsClient) await adsClient.disconnect().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));