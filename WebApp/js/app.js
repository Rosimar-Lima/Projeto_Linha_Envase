const elements = {
    btnStart: document.getElementById("btnLiga"),
    btnStop: document.getElementById("btnDesliga"),
    btnReset: document.getElementById("btnReset"),
    connectionLight: document.getElementById("indicadorConexao"),
    connectionText: document.getElementById("textoConexao"),
    operationText: document.getElementById("textoOperacao"),
    error: document.getElementById("mensagemErro"),
    filled: document.getElementById("contadorEnvasadas"),
    capped: document.getElementById("contadorTampadas"),
    total: document.getElementById("contadorTotal"),
    fillStatus: document.querySelector("#statusEnvase span"),
    capStatus: document.getElementById("estadoAplicacao"),
    instructionsButton: document.getElementById("btnInstrucoes"),
    instructionOptions: document.getElementById("opcoesInstrucoes"),
    instructionPanel: document.getElementById("painelInstrucoes"),
    instructionText: document.getElementById("textoInstrucao"),
    lineViewport: document.getElementById("linhaViewport"),
    line: document.getElementById("linha"),
    bottleContainer: document.getElementById("garrafas")
};

const BOTTLE_SPACING = 345;
const BOTTLE_SPEED = 150;
const LINE_WIDTH = 1200;

let socket;
let reconnectTimer;
let currentState = {
    connected: false,
    plcReady: false,
    runtimeState: "Indisponível",
    running: false,
    filled: 0,
    capped: 0,
    total: 0
};
let pendingCommand;
let bottles = [];
let previousFrameTime;
let spawnElapsed = 0;

function createBottle(position) {
    const bottle = document.createElement("img");
    bottle.className = "garrafaIhm";
    bottle.src = "images/garrafa vazia.png";
    bottle.alt = "Garrafa na esteira";
    bottle.style.left = `${position}px`;
    elements.bottleContainer.appendChild(bottle);
    bottles.push({ element: bottle, position });
}

function resetBottles() {
    bottles.forEach(bottle => bottle.element.remove());
    bottles = [];
    createBottle(20);
    createBottle(20 - BOTTLE_SPACING);
    spawnElapsed = 0;
}

function animateLine(frameTime) {
    const elapsed = previousFrameTime === undefined
        ? 0
        : Math.min((frameTime - previousFrameTime) / 1000, 0.05);
    previousFrameTime = frameTime;

    if (currentState.connected && currentState.plcReady && currentState.running) {
        bottles.forEach(bottle => {
            bottle.position += BOTTLE_SPEED * elapsed;
            bottle.element.style.left = `${bottle.position}px`;
        });

        spawnElapsed += elapsed;
        if (spawnElapsed >= BOTTLE_SPACING / BOTTLE_SPEED) {
            spawnElapsed -= BOTTLE_SPACING / BOTTLE_SPEED;
            const trailingPosition = Math.min(...bottles.map(bottle => bottle.position));
            createBottle(trailingPosition - BOTTLE_SPACING);
        }

        bottles = bottles.filter(bottle => {
            if (bottle.position <= LINE_WIDTH) return true;
            bottle.element.remove();
            return false;
        });
    } else {
        spawnElapsed = 0;
    }

    requestAnimationFrame(animateLine);
}

function ajustarLinhaParaTela() {
    const escala = Math.min(1, elements.lineViewport.clientWidth / 1200);
    elements.line.style.transform = `scale(${escala})`;
    elements.lineViewport.style.height = `${380 * escala}px`;
}

function renderState() {
    const connected = currentState.connected;
    const plcReady = connected && currentState.plcReady;
    const running = plcReady && currentState.running;
    elements.line.classList.toggle("transportando", running);
    elements.connectionLight.classList.toggle("conectado", plcReady);
    elements.connectionLight.classList.toggle("aguardando", connected && !plcReady);
    elements.connectionLight.classList.toggle("desconectado", !connected);
    elements.connectionText.textContent = !connected
        ? "ADS desconectado"
        : plcReady
            ? "PLC em execução"
            : `PLC parado (${currentState.runtimeState})`;
    elements.operationText.textContent = plcReady
        ? (currentState.running ? "Linha em operação" : "Linha parada")
        : "Comandos bloqueados";

    elements.btnStart.disabled = !plcReady || currentState.running || Boolean(pendingCommand);
    elements.btnStop.disabled = !plcReady || !currentState.running || Boolean(pendingCommand);
    elements.btnReset.disabled = !plcReady || currentState.running || Boolean(pendingCommand);

    elements.filled.textContent = currentState.filled;
    elements.capped.textContent = currentState.capped;
    elements.total.textContent = currentState.total;
    elements.fillStatus.textContent = "Estado não disponível";
    elements.capStatus.textContent = "Estado não disponível";
}

function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
}

function clearError() {
    elements.error.textContent = "";
    elements.error.hidden = true;
}

function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.addEventListener("open", clearError);
    socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.type === "state") {
            currentState = message;
            renderState();
        } else if (message.type === "commandResult") {
            pendingCommand = undefined;
            clearError();
            if (message.command === "reset") resetBottles();
            renderState();
        } else if (message.type === "error") {
            pendingCommand = undefined;
            showError(message.message);
            renderState();
        }
    });
    socket.addEventListener("close", () => {
        currentState = { ...currentState, connected: false };
        pendingCommand = undefined;
        renderState();
        reconnectTimer = window.setTimeout(connect, 1500);
    });
    socket.addEventListener("error", () => socket.close());
}

function sendCommand(command) {
    if (!currentState.plcReady || !socket || socket.readyState !== WebSocket.OPEN || pendingCommand) {
        showError("A comunicação com o PLC não está disponível.");
        return;
    }

    pendingCommand = command;
    clearError();
    renderState();
    socket.send(JSON.stringify({ type: "command", command }));
}

elements.btnStart.addEventListener("click", () => sendCommand("start"));
elements.btnStop.addEventListener("click", () => sendCommand("stop"));
elements.btnReset.addEventListener("click", () => sendCommand("reset"));

elements.instructionsButton.addEventListener("click", () => {
    const aberto = !elements.instructionOptions.hidden;
    elements.instructionOptions.hidden = aberto;
    elements.instructionPanel.hidden = aberto;
    if (aberto) elements.instructionText.textContent = "";
    elements.instructionsButton.setAttribute("aria-expanded", String(!aberto));
});

document.getElementById("instrucaoOn").addEventListener("click", () => {
    elements.instructionText.textContent = "On: envia o comando de partida ao PLC.";
    elements.instructionPanel.hidden = false;
});

document.getElementById("instrucaoOff").addEventListener("click", () => {
    elements.instructionText.textContent = "Off: envia o comando de parada ao PLC.";
    elements.instructionPanel.hidden = false;
});

document.getElementById("instrucaoReset").addEventListener("click", () => {
    elements.instructionText.textContent = "Reset: com a linha parada, solicita ao PLC que zere os contadores.";
    elements.instructionPanel.hidden = false;
});

window.addEventListener("resize", ajustarLinhaParaTela);
window.addEventListener("beforeunload", () => window.clearTimeout(reconnectTimer));

resetBottles();
ajustarLinhaParaTela();
renderState();
requestAnimationFrame(animateLine);
connect();
