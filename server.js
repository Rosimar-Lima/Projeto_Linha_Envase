const path = require("node:path");

// Carrega o .env ao lado do server.js, independente do diretorio de trabalho.
// Quando o servico sobe via daemon/Task Scheduler o cwd nao e a pasta do projeto.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const http = require("node:http");
const { spawn } = require("node:child_process");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { Client } = require("ads-client");
const { loadConfig } = require("./src/config");
const { clampPercent, createInitialState, resolveInterlocks } = require("./src/state");

const { server: config, plc, appVersion: APP_VERSION } = loadConfig(__dirname);
const COMMANDS = new Set(["start", "stop", "reset", "shutdown"]);

if (!plc.symbols.plcVersion) {
    console.warn("plc.config.json sem symbols.plcVersion; a versão do PLC não será exibida.");
}

function canShutdownVm() {
    if (process.platform === "win32") return false;
    if (typeof process.getuid === "function" && process.getuid() !== 0) return false;
    return true;
}

const app = express();
const server = http.createServer(app);
const sockets = new WebSocketServer({ server });
const ihmPath = path.join(__dirname, "IHM");

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
let lastAtBlocked = false;
let plcVersion = "";
let nextPlcVersionReadAt = 0;
let lastState = createInitialState({ appVersion: APP_VERSION, canShutdown: canShutdownVm() });

app.use(express.static(ihmPath, {
    setHeaders: (res, filePath) => {
        // HTML/CSS/JS sem cache: o navegador revalida a cada carregamento e o
        // Express responde 304 quando nada mudou. Isso dispensa bump manual de
        // `?v=` no index.html a cada edicao.
        if (/\.(?:html|css|m?js)$/.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
        }
    }
}));

function publishState(state) {
    lastState = { ...state, canShutdown: canShutdownVm() };
    const message = JSON.stringify({ type: "state", ...lastState });
    for (const socket of sockets.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
}

function publishConnectionState(connected, plcStatus, runtimeState = lastState.runtimeState) {
    publishState({
        ...lastState,
        connected,
        plcReady: false,
        plcStatus,
        runtimeState,
        running: false,
        evBlocked: false,
        atBlocked: false
    });
}

async function connectAds() {
    if (adsConnecting) return false;
    if (adsClient && adsClient.connection.connected) return true;
    if (Date.now() < nextAdsRetryAt) return false;
    if (adsClient) {
        if (adsLostAt === 0) adsLostAt = Date.now();
        if (Date.now() - adsLostAt < plc.recreateAfterMs) return false;
        await adsClient.disconnect().catch(() => {});
        adsClient = undefined;
        adsLostAt = 0;
    }
    adsConnecting = true;
    const client = new Client({
        targetAmsNetId: plc.targetAmsNetId,
        targetAdsPort: plc.targetAdsPort,
        timeoutDelay: plc.timeoutMs,
        autoReconnect: true
    });
    adsClient = client;

    client.on("connectionLost", () => {
        if (adsClient !== client) return;
        adsConnected = false;
        adsLostAt = Date.now();
        nextPlcVersionReadAt = 0;
        publishConnectionState(false, "offline");
        console.warn("Conexão ADS perdida; aguardando reconexão automática.");
    });
    client.on("reconnect", async () => {
        if (adsClient !== client) return;
        adsConnected = true;
        nextAdsRetryAt = 0;
        adsLostAt = 0;
        nextPlcVersionReadAt = 0;
        publishConnectionState(true, "checking");
        console.log(`ADS reconectado: ${plc.targetAmsNetId}:${plc.targetAdsPort}`);
        // O PLC pode ter sido recompilado/baixado durante a queda (novo boot project).
        // Se a tabela de simbolos mudou, os offsets em cache ficam invalidos e as
        // leituras retornam valores errados. Recarregar o cache garante handles atuais.
        try {
            await client.cacheSymbols();
            await client.cacheDataTypes();
        } catch (error) {
            console.warn(`Cache ADS indisponível após reconexão: ${error.message}`);
        }
    });

    try {
        await client.connect();
        adsConnected = Boolean(client.connection.connected);
        nextAdsRetryAt = 0;
        adsLostAt = 0;
        nextPlcVersionReadAt = 0;
        publishConnectionState(adsConnected, "checking");
        console.log(`ADS conectado: ${plc.targetAmsNetId}:${plc.targetAdsPort}`);
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
        publishConnectionState(false, "offline");
        console.error(`ADS indisponível: ${error.message}`);
        return false;
    } finally {
        adsConnecting = false;
    }
}

async function refreshPlcVersion() {
    if (!plc.symbols.plcVersion || Date.now() < nextPlcVersionReadAt) return;
    try {
        const version = await adsClient.readValue(plc.symbols.plcVersion);
        plcVersion = String(version.value ?? "").replace(/\0/g, "").trim();
    } catch (error) {
        // Mantem a ultima versao conhecida e tenta novamente mais tarde.
    } finally {
        nextPlcVersionReadAt = Date.now() + 60000;
    }
}

async function readPlcState() {
    if (plcStateReadInProgress || commandInProgress || adsWriteInProgress) return;
    plcStateReadInProgress = true;

    try {
        if (!(await connectAds())) return;

        const runtime = await adsClient.readState();
        if (runtime.adsStateStr !== "Run") {
            publishConnectionState(true, "stopped", runtime.adsStateStr);
            return;
        }

        await refreshPlcVersion();

        const running = await adsClient.readValue(plc.symbols.running);
        const sensorS1 = await adsClient.readValue(plc.symbols.sensorS1);
        const sensorS2 = await adsClient.readValue(plc.symbols.sensorS2);
        const bottlePositioned = await adsClient.readValue(plc.symbols.bottlePositioned);
        const conveyorOn = await adsClient.readValue(plc.symbols.conveyorOn);
        const evOn = await adsClient.readValue(plc.symbols.evOn);
        // As leituras ADS sao feitas uma a uma, entao `bottlePositioned` e `evOn`
        // podem vir de scans diferentes do PLC. Como o PLC garante
        // evOn => bottlePositioned no mesmo scan, uma releitura confirmatoria
        // evita falso positivo de intertravamento quando a borda de subida
        // cai no meio da janela de leitura.
        const bottlePositionedConfirm = await adsClient.readValue(plc.symbols.bottlePositioned);
        const atOn = await adsClient.readValue(plc.symbols.atOn);
        // Releitura confirmatoria de S2: `atOn` e `sensorS2` vem do mesmo scan do
        // PLC, mas como sao lidos em momentos diferentes a borda pode cair no meio
        // da janela e bloquear a AT indevidamente por um ciclo.
        const sensorS2Confirm = await adsClient.readValue(plc.symbols.sensorS2);
        const fillPercent = await adsClient.readValue(plc.symbols.fillPercent);
        const filled = await adsClient.readValue(plc.symbols.filled);
        const capped = await adsClient.readValue(plc.symbols.capped);
        const filledValue = Number(filled.value);
        const cappedValue = Number(capped.value);
        // Total = garrafas que concluiram envase e tampagem. Como a linha e FIFO,
        // cada garrafa tampada ja passou pelo envase; o min tambem protege contra
        // leituras intermediarias entre os dois contadores.
        const totalValue = Math.min(filledValue, cappedValue);

        const bottlePositionedValue = Boolean(bottlePositioned.value) || Boolean(bottlePositionedConfirm.value);
        const sensorS2Value = Boolean(sensorS2.value) || Boolean(sensorS2Confirm.value);
        const {
            evBlocked,
            evOn: safeEvOn,
            atBlocked,
            atOn: safeAtOn
        } = resolveInterlocks({
            evOn: evOn.value,
            bottlePositioned: bottlePositionedValue,
            atOn: atOn.value,
            sensorS2: sensorS2Value
        });

        if (evBlocked !== lastEvBlocked) {
            lastEvBlocked = evBlocked;
            if (evBlocked) console.warn("Intertravamento EV: pedido de envase sem garrafa posicionada; EV bloqueada.");
        }

        if (atBlocked !== lastAtBlocked) {
            lastAtBlocked = atBlocked;
            if (atBlocked) console.warn("Intertravamento AT: pedido de tampagem sem garrafa em S2; AT bloqueada.");
        }

        publishState({
            connected: true,
            plcReady: true,
            plcStatus: "ready",
            runtimeState: runtime.adsStateStr,
            appVersion: APP_VERSION,
            plcVersion,
            running: Boolean(running.value),
            sensorS1: Boolean(sensorS1.value),
            sensorS2: sensorS2Value,
            bottlePositioned: bottlePositionedValue,
            conveyorOn: Boolean(conveyorOn.value),
            evOn: safeEvOn,
            evBlocked,
            atOn: safeAtOn,
            atBlocked,
            fillPercent: clampPercent(fillPercent.value),
            filled: filledValue,
            capped: cappedValue,
            total: totalValue
        });
    } catch (error) {
        adsConnected = Boolean(adsClient?.connection.connected);
        publishConnectionState(adsConnected, adsConnected ? "fault" : "offline");
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
    const symbol = plc.symbols[command];
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
                const running = await client.readValue(plc.symbols.running);
                if (running.value) throw new Error("Desligue a linha antes de zerar os contadores.");
            }

            commandMayBeActive = true;
            await client.writeValue(symbol, true);
            await delay(plc.pulseMs);
            await client.writeValue(symbol, false);
        } finally {
            if (commandMayBeActive && adsConnected) await client.writeValue(symbol, false).catch(() => {});
            commandInProgress = false;
        }
    });
}

function shutdownVm() {
    if (!canShutdownVm()) {
        throw new Error("Desligamento da VM indisponível: o serviço precisa rodar como root em FreeBSD/Linux.");
    }

    const command = process.platform === "freebsd" ? "/sbin/shutdown" : "shutdown";
    const args = process.platform === "freebsd" ? ["-p", "now"] : ["-h", "now"];

    setTimeout(() => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.on("error", error => console.error(`Falha ao desligar a VM: ${error.message}`));
        child.unref();
    }, 500);
}

sockets.on("connection", socket => {
    socket.send(JSON.stringify({ type: "state", ...lastState }));
    socket.on("message", async data => {
        let message;
        try {
            message = JSON.parse(data.toString());
            if (message.type !== "command" || !COMMANDS.has(message.command)) {
                throw new Error("Mensagem inválida.");
            }
            if (message.command === "shutdown") {
                if (lastState.running) throw new Error("Desligue a linha antes de desligar a VM.");
                shutdownVm();
                socket.send(JSON.stringify({ type: "commandResult", command: "shutdown" }));
                return;
            }
            await pulseCommand(message.command);
            await readPlcState();
            socket.send(JSON.stringify({ type: "commandResult", command: message.command }));
        } catch (error) {
            socket.send(JSON.stringify({ type: "error", message: error.message }));
        }
    });
});

const stateInterval = setInterval(readPlcState, plc.pollIntervalMs);

server.listen(config.port, config.host, () => {
    console.log(`IHM disponível em http://${config.host}:${config.port}`);
    console.log(`Rota TwinCAT local -> ${plc.targetAmsNetId}:${plc.targetAdsPort}`);
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