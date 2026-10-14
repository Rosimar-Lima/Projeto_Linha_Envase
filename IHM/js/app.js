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
    capper: document.getElementById("aplicadora"),
    instructionsButton: document.getElementById("btnInstrucoes"),
    instructionOptions: document.getElementById("opcoesInstrucoes"),
    instructionPanel: document.getElementById("painelInstrucoes"),
    instructionText: document.getElementById("textoInstrucao"),
    lineViewport: document.getElementById("linhaViewport"),
    line: document.getElementById("linha"),
    bottleContainer: document.getElementById("garrafas")
};

const LINE_WIDTH = 1200;
const S1_CENTER = 435;
const BOTTLE_WIDTH = 60;
const S1_BOTTLE_POSITION = S1_CENTER - BOTTLE_WIDTH / 2;
const BOTTLE_SPACING = 330;
const BOTTLE_SPEED = BOTTLE_SPACING / 3;
const BOTTLE_ART_RIGHT = 55.3;
const S1_TRIGGER_POSITION = S1_CENTER - BOTTLE_ART_RIGHT;
const BOTTLE_ENTRY_POSITION = 20;
const BELT_PATTERN_WIDTH = 68;
const LIQUID_MAX_HEIGHT = 115;
const EV_STOP_TOLERANCE = 5;
const APPROACH_K = 8;
const SNAP_EPSILON = 1;
// Teto do delta entre quadros. Se um quadro demorar mais que isso, a esteira
// anda proporcionalmente ao tempo real em vez de "ficar para tras" e saltar.
const MAX_FRAME_DELTA_S = 0.25;
// Velocidade de suavizacao do nivel de liquido (fracao por segundo).
const FILL_EASE_PER_SECOND = 6;
const FILL_DONE_PERCENT = 100;

let socket;
let reconnectTimer;
let currentState = {
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
let pendingCommand;
let bottles = [];
let bottleAtS1;
let previousFrameTime;
let previousLiquidTime;
let beltPosition = 0;
let activeDeceleration;
let waitingForPlcStop = false;

function createBottle(position) {
    const bottle = document.createElement("div");
    bottle.className = "garrafaIhm";
    bottle.style.left = `${position}px`;

    const liquid = document.createElement("div");
    liquid.className = "liquidoGarrafa";

    const image = document.createElement("img");
    image.className = "contornoGarrafa";
    image.src = "images/garrafa_vazia.png";
    image.alt = "Garrafa na esteira";

    bottle.append(liquid, image);
    elements.bottleContainer.appendChild(bottle);
    const bottleState = { element: bottle, liquid, position, fillPercent: 0, displayHeight: 0 };
    bottles.push(bottleState);
    return bottleState;
}

function resetBottleFill(bottle) {
    bottle.fillPercent = 0;
    bottle.displayHeight = 0;
    bottle.liquid.style.height = "0";
}

function getLeadingBottle() {
    return bottles
        .filter(bottle => bottle !== bottleAtS1 && bottle.position <= S1_BOTTLE_POSITION)
        .reduce((leading, bottle) => !leading || bottle.position > leading.position ? bottle : leading, undefined);
}

function maintainBottleQueue() {
    if (bottles.length === 0) return;
    let trailingPosition = bottles.reduce((trailing, bottle) => Math.min(trailing, bottle.position), Infinity);

    while (trailingPosition > BOTTLE_ENTRY_POSITION) {
        trailingPosition -= BOTTLE_SPACING;
        createBottle(trailingPosition);
    }
}

function moveBottleQueue(distance) {
    if (distance <= 0) return;

    bottles.forEach(bottle => {
        bottle.position += distance;
        bottle.element.style.left = `${bottle.position}px`;
    });

    beltPosition = (beltPosition + distance) % BELT_PATTERN_WIDTH;
    elements.line.style.setProperty("--belt-position", `${beltPosition}px`);

    bottles = bottles.filter(bottle => {
        if (bottle.position <= LINE_WIDTH) return true;
        if (bottle === bottleAtS1) bottleAtS1 = undefined;
        bottle.element.remove();
        return false;
    });

    maintainBottleQueue();
}

function resetBottles() {
    bottles.forEach(bottle => bottle.element.remove());
    bottles = [];
    createBottle(BOTTLE_ENTRY_POSITION);
    createBottle(BOTTLE_ENTRY_POSITION - BOTTLE_SPACING);
    bottleAtS1 = undefined;
    activeDeceleration = undefined;
    waitingForPlcStop = false;
    previousFrameTime = undefined;
    previousLiquidTime = undefined;
    beltPosition = 0;
    elements.line.style.setProperty("--belt-position", "0px");
    maintainBottleQueue();
}

function animateLine(frameTime) {
    const elapsed = previousFrameTime === undefined
        ? 0
        : Math.min((frameTime - previousFrameTime) / 1000, MAX_FRAME_DELTA_S);
    previousFrameTime = frameTime;

    // O nivel de liquido usa um relogio proprio, que avanca sempre. O relogio
    // da esteira (previousFrameTime) e zerado enquanto a garrafa esta parada na
    // EV para a esteira nao "saltar" ao religar; se o liquido usasse o mesmo
    // relogio, a animacao de envase so aconteceria com a garrafa em movimento.
    const liquidElapsed = previousLiquidTime === undefined
        ? 0
        : Math.min((frameTime - previousLiquidTime) / 1000, MAX_FRAME_DELTA_S);
    previousLiquidTime = frameTime;

    const machineRunning = currentState.connected && currentState.plcReady && currentState.running;
    // Mecanismo de seguranca: com a EV atuando a esteira fica travada.
    const beltMoving = machineRunning && currentState.conveyorOn && !currentState.bottlePositioned && !currentState.evOn;
    const parkedBottleFilled = !bottleAtS1 || bottleAtS1.fillPercent >= FILL_DONE_PERCENT;

    if (waitingForPlcStop && beltMoving && parkedBottleFilled) {
        waitingForPlcStop = false;
    }

    for (const bottle of bottles) {
        const targetHeight = (bottle.fillPercent / 100) * LIQUID_MAX_HEIGHT;
        if (Math.abs(bottle.displayHeight - targetHeight) > 0.3) {
            const ease = Math.min(1, liquidElapsed * FILL_EASE_PER_SECOND);
            bottle.displayHeight += (targetHeight - bottle.displayHeight) * ease;
            bottle.liquid.style.height = `${bottle.displayHeight}px`;
        }
    }

    if (activeDeceleration && machineRunning) {
        const leadingBottle = activeDeceleration.bottle;
        const distanceToStop = S1_BOTTLE_POSITION - leadingBottle.position;
        if (distanceToStop <= SNAP_EPSILON) {
            moveBottleQueue(Math.max(0, distanceToStop));
            activeDeceleration = undefined;
            if (leadingBottle !== bottleAtS1) {
                resetBottleFill(leadingBottle);
                bottleAtS1 = leadingBottle;
            }
            waitingForPlcStop = true;
        } else {
            // Desaceleracao exponencial ate o ponto de parada, limitada a
            // velocidade da esteira (sem "arrancada" e sem salto).
            const approachSpeed = Math.min(BOTTLE_SPEED, distanceToStop * APPROACH_K);
            moveBottleQueue(Math.min(approachSpeed * elapsed, distanceToStop));
        }
    } else if (machineRunning && !waitingForPlcStop) {
        if (bottles.length === 0) createBottle(BOTTLE_ENTRY_POSITION);

        const leadingBottle = getLeadingBottle();
        if (leadingBottle) {
            const distanceToStop = S1_BOTTLE_POSITION - leadingBottle.position;
            const reachedTrigger = leadingBottle.position >= S1_TRIGGER_POSITION;

            if (distanceToStop <= SNAP_EPSILON) {
                moveBottleQueue(Math.max(0, distanceToStop));
                if (leadingBottle !== bottleAtS1) {
                    resetBottleFill(leadingBottle);
                    bottleAtS1 = leadingBottle;
                }
                waitingForPlcStop = true;
            } else if (reachedTrigger || !currentState.conveyorOn) {
                activeDeceleration = { bottle: leadingBottle };
            } else if (beltMoving) {
                moveBottleQueue(Math.min(BOTTLE_SPEED * elapsed, distanceToStop));
            } else {
                previousFrameTime = undefined;
            }
        } else {
            previousFrameTime = undefined;
        }
    } else {
        previousFrameTime = undefined;
    }

    requestAnimationFrame(animateLine);
}

function ajustarLinhaParaTela() {
    const escala = Math.min(1, elements.lineViewport.clientWidth / 1200);
    elements.line.style.transform = `scale(${escala})`;
    elements.lineViewport.style.height = `${456 * escala}px`;
}

function renderState() {
    const connected = currentState.connected;
    const plcReady = connected && currentState.plcReady;
    const running = plcReady && currentState.running;
    const plcStatus = currentState.plcStatus || (plcReady ? "ready" : "checking");
    elements.line.classList.toggle("transportando", plcReady && running && currentState.conveyorOn);
    elements.capper.classList.toggle("aplicando", plcReady && currentState.atOn);
    elements.connectionLight.classList.toggle("conectado", plcReady);
    elements.connectionLight.classList.toggle("aguardando", ["checking", "stopped"].includes(plcStatus));
    elements.connectionLight.classList.toggle("desconectado", ["offline", "fault"].includes(plcStatus));

    const connectionMessages = {
        checking: "Verificando comunicação com o PLC...",
        offline: "Sem comunicação com o PLC; tentando reconectar...",
        fault: "Falha no teste de comunicação do PLC",
        stopped: `PLC conectado; runtime em ${currentState.runtimeState}`,
        ready: "PLC pronto para operação"
    };
    elements.connectionText.textContent = connectionMessages[plcStatus] || connectionMessages.checking;

    if (plcStatus === "ready") {
        elements.operationText.textContent = running ? "Linha em operação" : "Pronto para iniciar";
    } else if (plcStatus === "checking") {
        elements.operationText.textContent = "Autoteste de comunicação em andamento";
    } else if (plcStatus === "stopped") {
        elements.operationText.textContent = "Operação bloqueada: coloque o runtime em Run";
    } else {
        elements.operationText.textContent = "Operação bloqueada: comunicação indisponível";
    }

    elements.btnStart.disabled = !plcReady || currentState.running || Boolean(pendingCommand);
    elements.btnStop.disabled = !plcReady || !currentState.running || Boolean(pendingCommand);
    elements.btnReset.disabled = !plcReady || currentState.running || Boolean(pendingCommand);

    elements.filled.textContent = plcReady ? currentState.filled : "--";
    elements.capped.textContent = plcReady ? currentState.capped : "--";
    elements.total.textContent = plcReady ? currentState.total : "--";
    elements.fillStatus.textContent = !plcReady
        ? "Estado indisponível"
        : currentState.evOn
            ? `Dosando: ${currentState.fillPercent}%`
            : currentState.bottlePositioned
                ? "Garrafa posicionada"
                : currentState.sensorS1
                    ? "S1 detectou garrafa"
                    : "Aguardando S1";
    elements.capStatus.textContent = !plcReady
        ? "Estado indisponível"
        : currentState.atOn
            ? "Aplicando tampa"
            : "Aguardando garrafa";
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
        const { type, ...message } = JSON.parse(event.data);
        if (type === "state") {
            const previousState = currentState;
            const newBottlePositioned = message.bottlePositioned && !previousState.bottlePositioned;
            if (newBottlePositioned) {
                const positionedBottle = bottleAtS1 && Math.abs(bottleAtS1.position - S1_BOTTLE_POSITION) <= EV_STOP_TOLERANCE
                    ? bottleAtS1
                    : (getLeadingBottle() || createBottle(S1_BOTTLE_POSITION));
                resetBottleFill(positionedBottle);
                bottleAtS1 = positionedBottle;
                activeDeceleration = { bottle: positionedBottle };
                waitingForPlcStop = false;
            } else if (message.bottlePositioned && !bottleAtS1) {
                // Garante rastreio da garrafa sob a EV mesmo se a borda de
                // subida de bottlePositioned for perdida entre leituras.
                bottleAtS1 = getLeadingBottle() || createBottle(S1_BOTTLE_POSITION);
            }
            currentState = message;

            // Nivel de liquido conduzido pelo PLC (fonte da verdade): so a
            // garrafa sob a EV e atualizada, apenas enquanto o PLC indica
            // presenca/envase. Ao terminar o envase, garante 100% para a
            // garrafa sair cheia. O nivel nunca regride numa garrafa cheia.
            if (bottleAtS1) {
                const fillActive = Boolean(message.bottlePositioned) || Boolean(message.evOn);
                if (fillActive) {
                    const plcPercent = Math.max(0, Math.min(100, Number(message.fillPercent) || 0));
                    if (plcPercent > bottleAtS1.fillPercent) {
                        bottleAtS1.fillPercent = plcPercent;
                    }
                } else if (previousState.bottlePositioned || previousState.evOn) {
                    bottleAtS1.fillPercent = FILL_DONE_PERCENT;
                }
            }

            renderState();
        } else if (type === "commandResult") {
            pendingCommand = undefined;
            clearError();
            if (message.command === "reset") resetBottles();
            renderState();
        } else if (type === "error") {
            pendingCommand = undefined;
            showError(message.message);
            renderState();
        }
    });
    socket.addEventListener("close", () => {
        currentState = {
            ...currentState,
            connected: false,
            plcReady: false,
            plcStatus: "offline",
            running: false
        };
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

    if (command === "start") resetBottles();
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
