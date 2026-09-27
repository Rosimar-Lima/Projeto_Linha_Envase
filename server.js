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

const symbols = {
    start: "GVL_HMI.bCmdStart",
    stop: "GVL_HMI.bCmdStop",
    reset: "GVL_HMI.bCmdReset",
    running: "GVL_HMI.bRunning",
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
let commandInProgress = false;
let lastState = {
    connected: false,
    plcReady: false,
    runtimeState: "Indisponível",
    running: false,
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
    if (adsConnected || adsConnecting) return adsConnected;
    if (Date.now() < nextAdsRetryAt) return false;
    adsConnecting = true;
    const client = new Client({
        targetAmsNetId: config.targetAmsNetId,
        targetAdsPort: config.targetAdsPort
    });

    try {
        await client.connect();
        adsClient = client;
        adsConnected = true;
        nextAdsRetryAt = 0;
        console.log(`ADS conectado: ${config.targetAmsNetId}:${config.targetAdsPort}`);
        return true;
    } catch (error) {
        await client.disconnect().catch(() => {});
        adsClient = undefined;
        adsConnected = false;
        nextAdsRetryAt = Date.now() + 5000;
        publishState({ ...lastState, connected: false, plcReady: false, running: false });
        console.error(`ADS indisponível: ${error.message}`);
        return false;
    } finally {
        adsConnecting = false;
    }
}

async function readPlcState() {
    if (!(await connectAds())) return;

    try {
        const runtime = await adsClient.readState();
        if (runtime.adsStateStr !== "Run") {
            publishState({
                ...lastState,
                connected: true,
                plcReady: false,
                runtimeState: runtime.adsStateStr,
                running: false
            });
            return;
        }

        const [running, filled, capped, total] = await Promise.all([
            adsClient.readValue(symbols.running),
            adsClient.readValue(symbols.filled),
            adsClient.readValue(symbols.capped),
            adsClient.readValue(symbols.total)
        ]);

        publishState({
            connected: true,
            plcReady: true,
            runtimeState: runtime.adsStateStr,
            running: Boolean(running.value),
            filled: Number(filled.value),
            capped: Number(capped.value),
            total: Number(total.value)
        });
    } catch (error) {
        adsConnected = false;
        await adsClient?.disconnect().catch(() => {});
        adsClient = undefined;
        publishState({ ...lastState, connected: false, plcReady: false, running: false });
        console.error(`Falha ao ler o PLC: ${error.message}`);
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function pulseCommand(command) {
    if (!(await connectAds())) throw new Error("PLC TwinCAT não conectado via ADS.");
    if (commandInProgress) throw new Error("Aguarde o comando atual terminar.");

    const runtime = await adsClient.readState();
    if (runtime.adsStateStr !== "Run") {
        await readPlcState();
        throw new Error(`PLC em ${runtime.adsStateStr}; coloque o runtime em Run para enviar comandos.`);
    }

    const symbol = symbols[command];
    if (!symbol) throw new Error("Comando desconhecido.");

    commandInProgress = true;
    try {
        if (command === "reset") {
            const running = await adsClient.readValue(symbols.running);
            if (running.value) throw new Error("Desligue a linha antes de zerar os contadores.");
        }

        await adsClient.writeValue(symbol, true);
        await delay(120);
        await adsClient.writeValue(symbol, false);
    } finally {
        if (adsConnected) await adsClient.writeValue(symbol, false).catch(() => {});
        commandInProgress = false;
    }
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

setInterval(readPlcState, 500);

server.listen(config.port, config.host, () => {
    console.log(`IHM disponível em http://${config.host}:${config.port}`);
    console.log(`Rota TwinCAT local -> ${config.targetAmsNetId}:${config.targetAdsPort}`);
});