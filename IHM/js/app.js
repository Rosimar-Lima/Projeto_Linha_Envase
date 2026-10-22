const elements = {
    btnStart: document.getElementById("btnLiga"),
    btnStop: document.getElementById("btnDesliga"),
    btnReset: document.getElementById("btnReset"),
    btnResetApp: document.getElementById("btnResetApp"),
    btnShutdown: document.getElementById("btnDesligar"),
    error: document.getElementById("mensagemErro"),
    filled: document.getElementById("contadorEnvasadas"),
    capped: document.getElementById("contadorTampadas"),
    total: document.getElementById("contadorTotal"),
    appVersion: document.getElementById("versaoAplicacao"),
    plcVersion: document.getElementById("versaoPlc"),
    fillStatus: document.querySelector("#statusEnvase span"),
    capStatus: document.getElementById("estadoAplicacao"),
    capper: document.getElementById("aplicadora"),
    sensorBulletS1: document.getElementById("bulletS1"),
    sensorBulletS2: document.getElementById("bulletS2"),
    lineViewport: document.getElementById("linhaViewport"),
    line: document.getElementById("linha"),
    bottleContainer: document.getElementById("garrafas"),
    commFailureOverlay: document.getElementById("overlayFalhaComunicacao"),
    estadoResumo: document.getElementById("estadoResumo"),
    estadoResumoDot: document.getElementById("estadoResumoDot"),
    estadoResumoTexto: document.getElementById("estadoResumoTexto"),
    splash: document.getElementById("splashAplicacao"),
    splashMessage: document.getElementById("splashMensagem"),
    splashProgress: document.getElementById("splashProgresso"),
    splashPercent: document.getElementById("splashPercentual"),
    splashServices: document.getElementById("splashServicos"),
    shutdownOverlay: document.getElementById("overlayDesligamento"),
    shutdownMessage: document.getElementById("mensagemDesligamento")
};

const estadoRows = {};
document.querySelectorAll("#painelEstados [data-estado]").forEach(row => {
    estadoRows[row.dataset.estado] = {
        dot: row.querySelector(".estadoDot"),
        valor: row.querySelector(".estadoValor")
    };
});

const LINE_WIDTH = 1200;
const S1_CENTER = 435;
// A AT fica um passo de garrafa (330 px) a direita da EV: 435 + 330 = 765.
const S2_CENTER = S1_CENTER + 330;
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
    appVersion: "",
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
    canShutdown: false
};
let pendingCommand;
let bottles = [];
let bottleAtS1;
let previousFrameTime;
let previousLiquidTime;
let beltPosition = 0;
let activeDeceleration;
let waitingForPlcStop = false;
// Estado travado da faixa de falha de comunicacao: so limpa quando o PLC
// confirma comunicacao (ready/stopped), evitando piscar durante reconexao.
let commFailureActive = false;
let shutdownRequested = false;
let resetSequenceActive = false;
let splashVisible = document.documentElement.classList.contains("mostrarSplash");
let splashFinished = false;
let splashFallbackTimer;
let splashRunning = false;
let splashStage = 0;
let splashSocketOpen = false;
let splashLatestState = { connected: false, plcReady: false };
const SPLASH_STORAGE_KEY = "linhaEnvaseReset";
const SPLASH_SERVICE_LABELS = {
    interface: "Interface IHM",
    tempoReal: "Atualização em tempo real",
    ads: "Conexão com a ponte ADS",
    plc: "Leitura do PLC"
};
const splashServiceRows = {};
const RESET_INTRO_MS = 450;
const RESET_DEACTIVATE_TOTAL_MS = 4800;
const RESET_DEACTIVATE_STEP_MS = RESET_DEACTIVATE_TOTAL_MS / 4;
const RESET_AFTER_DEACTIVATE_MS = 350;
const RESET_BEFORE_RELOAD_MS = 300;
const RESET_STARTUP_HOLD_MS = 120;
const RESET_STARTUP_SEGMENT_MS = 850;
const RESET_STARTUP_SETTLE_MS = 120;
const RESET_DONE_MS = 600;

const splashStages = [
    { key: "interface", ready: () => true, message: "Iniciando interface IHM…", waitMessage: "" },
    { key: "tempoReal", ready: () => splashSocketOpen, message: "Abrindo atualização em tempo real…", waitMessage: "Aguardando a conexão em tempo real…" },
    { key: "ads", ready: () => splashLatestState.connected, message: "Conectando à ponte ADS…", waitMessage: "Aguardando a ponte ADS…" },
    { key: "plc", ready: () => splashLatestState.plcReady, message: "Lendo o PLC…", waitMessage: "Aguardando o PLC…" }
];

function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function setSplashMessage(message) {
    if (elements.splashMessage) elements.splashMessage.textContent = message;
}

function setSplashProgress(percent) {
    const value = Math.max(0, Math.min(100, percent));
    if (elements.splashProgress) elements.splashProgress.style.width = `${value}%`;
    if (elements.splashPercent) elements.splashPercent.textContent = `${Math.round(value)}%`;
}

function animateSplashProgress(from, to, duration) {
    return new Promise(resolve => {
        const start = performance.now();
        const finish = () => {
            setSplashProgress(to);
            resolve();
        };
        if (duration <= 0) {
            finish();
            return;
        }
        const frame = now => {
            const elapsed = Math.min(now - start, duration);
            const ratio = elapsed / duration;
            setSplashProgress(from + (to - from) * ratio);
            if (elapsed < duration) {
                requestAnimationFrame(frame);
            } else {
                finish();
            }
        };
        requestAnimationFrame(frame);
    });
}

function setSplashPhase(phase) {
    if (elements.splash) elements.splash.dataset.fase = phase;
}

function clearSplashServices() {
    if (elements.splashServices) elements.splashServices.replaceChildren();
    for (const key of Object.keys(splashServiceRows)) delete splashServiceRows[key];
}

function ensureSplashService(key) {
    if (splashServiceRows[key]) return splashServiceRows[key];
    if (!elements.splashServices) return null;

    const row = document.createElement("li");
    row.dataset.servico = key;
    row.dataset.estado = "aguardando";

    const name = document.createElement("span");
    name.className = "splashServicoNome";
    name.textContent = SPLASH_SERVICE_LABELS[key] || key;

    const status = document.createElement("span");
    status.className = "splashServicoStatus aguardando";
    status.textContent = "Aguardando…";

    row.append(name, status);
    elements.splashServices.append(row);
    splashServiceRows[key] = { row, status };
    return splashServiceRows[key];
}

function setSplashService(key, text, state) {
    const entry = ensureSplashService(key);
    if (!entry) return;
    entry.status.textContent = text;
    entry.status.className = `splashServicoStatus ${state}`;
    entry.row.dataset.estado = state;
}

function hideSplash() {
    if (!splashVisible) return;
    splashVisible = false;
    window.clearTimeout(splashFallbackTimer);
    try {
        sessionStorage.removeItem(SPLASH_STORAGE_KEY);
    } catch (error) { }
    document.documentElement.classList.remove("mostrarSplash");
}

async function runResetDeactivation() {
    const steps = [
        { key: "interface", message: "Desativando interface IHM…" },
        { key: "tempoReal", message: "Encerrando atualização em tempo real…" },
        { key: "ads", message: "Desconectando a ponte ADS…" },
        { key: "plc", message: "Interrompendo leitura do PLC…" }
    ];

    clearSplashServices();
    setSplashPhase("desativando");
    setSplashProgress(100);
    setSplashMessage("Preparando reset da aplicação…");
    await wait(RESET_INTRO_MS);

    const progressAnimation = animateSplashProgress(100, 0, RESET_DEACTIVATE_TOTAL_MS);
    for (const step of steps) {
        setSplashMessage(step.message);
        setSplashService(step.key, "Desativando…", "desativando");
        await wait(RESET_DEACTIVATE_STEP_MS);
        if (step.key === "tempoReal" && socket) {
            try {
                socket.close();
            } catch (error) { }
        }
        setSplashService(step.key, "Desativado", "desativado");
    }
    await progressAnimation;

    setSplashMessage("Aplicação desativada.");
    await wait(RESET_AFTER_DEACTIVATE_MS);

    for (let remaining = 3; remaining > 0; remaining--) {
        setSplashMessage(`Aplicação desativada. Reiniciando em ${remaining}…`);
        await wait(1000);
    }

    setSplashMessage("Reiniciando aplicação…");
    await wait(RESET_BEFORE_RELOAD_MS);
}

async function runStartupStages() {
    if (!splashVisible || splashFinished || splashRunning) return;
    splashRunning = true;
    setSplashPhase("ativando");

    while (splashStage < splashStages.length) {
        const stage = splashStages[splashStage];
        if (!stage.ready()) {
            setSplashMessage(stage.waitMessage);
            splashRunning = false;
            return;
        }

        const from = splashStage * 25;
        const to = (splashStage + 1) * 25;
        setSplashMessage(stage.message);
        setSplashService(stage.key, "Iniciando…", "iniciando");
        await wait(RESET_STARTUP_HOLD_MS);
        await animateSplashProgress(from, to, RESET_STARTUP_SEGMENT_MS);
        setSplashService(stage.key, "Ativo", "ativo");
        splashStage += 1;
        await wait(RESET_STARTUP_SETTLE_MS);
    }

    splashFinished = true;
    splashRunning = false;
    window.clearTimeout(splashFallbackTimer);
    setSplashMessage("Tudo pronto. Abrindo a IHM…");
    await wait(RESET_DONE_MS);
    hideSplash();
}

function startSplashFallback() {
    if (!splashVisible) return;
    splashFallbackTimer = window.setTimeout(() => {
        if (splashFinished) return;
        splashFinished = true;
        setSplashMessage("Não foi possível confirmar o PLC. Exibindo a IHM…");
        window.setTimeout(hideSplash, 1200);
    }, 15000);
}

if (splashVisible) {
    clearSplashServices();
    setSplashPhase("ativando");
    setSplashProgress(0);
}

function showShutdownOverlay(message) {
    if (elements.shutdownMessage) elements.shutdownMessage.textContent = message;
    if (elements.shutdownOverlay) elements.shutdownOverlay.hidden = false;
}

function hideShutdownOverlay() {
    if (elements.shutdownOverlay) elements.shutdownOverlay.hidden = true;
}

function updateCommFailureOverlay(plcStatus) {
    if (plcStatus === "offline" || plcStatus === "fault") {
        commFailureActive = true;
    } else if (plcStatus === "ready" || plcStatus === "stopped") {
        commFailureActive = false;
    }
    if (elements.commFailureOverlay) {
        elements.commFailureOverlay.hidden = !commFailureActive;
    }
}

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

    // Bullet de cada sensor: verde quando o sensor esta ativo (sinal do PLC ou
    // garrafa cobrindo o sensor) e cinza quando inativo.
    const plcReady = currentState.connected && currentState.plcReady;
    const sensors = [
        { bullet: elements.sensorBulletS1, center: S1_CENTER, signal: currentState.sensorS1 },
        { bullet: elements.sensorBulletS2, center: S2_CENTER, signal: currentState.sensorS2 }
    ];
    for (const sensor of sensors) {
        const detected = bottles.some(bottle =>
            bottle.position <= sensor.center && bottle.position + BOTTLE_WIDTH >= sensor.center);
        sensor.bullet.classList.toggle("on", Boolean(plcReady) && (Boolean(sensor.signal) || detected));
    }

    requestAnimationFrame(animateLine);
}

function ajustarLinhaParaTela() {
    const escala = Math.min(1, elements.lineViewport.clientWidth / 1200);
    elements.line.style.transform = `scale(${escala})`;
    elements.lineViewport.style.height = `${486 * escala}px`;
}

function setEstado(chave, valor, classe) {
    const row = estadoRows[chave];
    if (!row) return;
    row.valor.textContent = valor;
    row.dot.className = `estadoDot${classe ? ` ${classe}` : ""}`;
}

function renderEstados() {
    const plcStatus = currentState.plcStatus || "checking";
    const plcReady = currentState.connected && currentState.plcReady;
    const dadosDisponiveis = Boolean(plcReady);

    let plcValor = "Verificando…";
    let plcClasse = "aviso";
    if (plcStatus === "ready") {
        plcValor = "Conectado (Run)";
        plcClasse = "ok";
    } else if (plcStatus === "stopped") {
        plcValor = "Conectado (Stop)";
        plcClasse = "aviso";
    } else if (plcStatus === "offline" || plcStatus === "fault") {
        plcValor = "Sem comunicação";
        plcClasse = "falha";
    }
    setEstado("plc", plcValor, plcClasse);

    setEstado(
        "esteira",
        dadosDisponiveis ? (currentState.conveyorOn ? "Ligada" : "Desligada") : "—",
        dadosDisponiveis && currentState.conveyorOn ? "ok" : ""
    );
    setEstado(
        "s1",
        dadosDisponiveis ? (currentState.sensorS1 ? "On" : "Off") : "—",
        dadosDisponiveis && currentState.sensorS1 ? "ok" : ""
    );
    setEstado(
        "ev",
        dadosDisponiveis ? (currentState.evOn ? "Envasando" : "Parada") : "—",
        !dadosDisponiveis ? "" : currentState.evBlocked ? "falha" : currentState.evOn ? "ok" : ""
    );
    setEstado(
        "s2",
        dadosDisponiveis ? (currentState.sensorS2 ? "On" : "Off") : "—",
        dadosDisponiveis && currentState.sensorS2 ? "ok" : ""
    );
    setEstado(
        "at",
        dadosDisponiveis ? (currentState.atOn ? "Tampando" : "Parada") : "—",
        !dadosDisponiveis ? "" : currentState.atBlocked ? "falha" : currentState.atOn ? "ok" : ""
    );

    let resumo;
    let resumoClasse;
    if (plcStatus === "offline" || plcStatus === "fault") {
        resumo = "FALHA: sem comunicação com o PLC";
        resumoClasse = "falha";
    } else if (currentState.evBlocked) {
        resumo = "FALHA: intertravamento da EV";
        resumoClasse = "falha";
    } else if (currentState.atBlocked) {
        resumo = "FALHA: intertravamento da AT";
        resumoClasse = "falha";
    } else if (plcStatus === "stopped") {
        resumo = "ATENÇÃO: runtime em Stop";
        resumoClasse = "aviso";
    } else if (!plcReady || plcStatus === "checking") {
        resumo = "Verificando comunicação…";
        resumoClasse = "aviso";
    } else {
        resumo = "SISTEMA OK";
        resumoClasse = "ok";
    }
    elements.estadoResumo.className = `estadoResumo ${resumoClasse}`;
    elements.estadoResumoDot.className = `estadoDot ${resumoClasse}`;
    elements.estadoResumoTexto.textContent = resumo;
}

function renderState() {
    const connected = currentState.connected;
    const plcReady = connected && currentState.plcReady;
    const plcStatus = currentState.plcStatus || (plcReady ? "ready" : "checking");
    updateCommFailureOverlay(plcStatus);
    elements.capper.classList.toggle("aplicando", plcReady && currentState.atOn);

    elements.btnStart.disabled = !plcReady || currentState.running || Boolean(pendingCommand);
    elements.btnStop.disabled = !plcReady || !currentState.running || Boolean(pendingCommand);
    elements.btnReset.disabled = !plcReady || currentState.running || Boolean(pendingCommand);
    elements.btnResetApp.disabled = currentState.running || Boolean(pendingCommand) || shutdownRequested || resetSequenceActive;
    elements.btnShutdown.disabled = !connected || !currentState.canShutdown || currentState.running || Boolean(pendingCommand) || shutdownRequested || resetSequenceActive;

    elements.appVersion.textContent = currentState.appVersion || "—";
    elements.plcVersion.textContent = currentState.plcVersion || "—";

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
            ? "Tampando garrafa"
            : currentState.sensorS2
                ? "Garrafa em S2"
                : "Aguardando garrafa";

    renderEstados();
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

    socket.addEventListener("open", () => {
        splashSocketOpen = true;
        clearError();
        runStartupStages();
    });
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
            splashLatestState = message;
            runStartupStages();
        } else if (type === "commandResult") {
            pendingCommand = undefined;
            clearError();
            if (message.command === "reset") resetBottles();
            if (message.command === "shutdown") {
                showShutdownOverlay("Sistema desligando. Aguarde o encerramento da VM.");
                return;
            }
            renderState();
        } else if (type === "error") {
            pendingCommand = undefined;
            shutdownRequested = false;
            hideShutdownOverlay();
            showError(message.message);
            renderState();
        }
    });
    socket.addEventListener("close", () => {
        if (resetSequenceActive) return;
        splashSocketOpen = false;
        if (splashVisible && !splashFinished) {
            setSplashMessage("Reconectando à IHM…");
        }
        if (shutdownRequested) {
            showShutdownOverlay("Conexão encerrada. A VM está desligando…");
        }
        currentState = {
            ...currentState,
            connected: false,
            plcReady: false,
            plcStatus: "offline",
            running: false,
            evBlocked: false,
            atBlocked: false
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

    pendingCommand = command;
    clearError();
    renderState();
    socket.send(JSON.stringify({ type: "command", command }));
}

async function resetApplication() {
    if (currentState.running || pendingCommand || shutdownRequested || resetSequenceActive) return;
    resetSequenceActive = true;
    renderState();
    document.documentElement.classList.add("mostrarSplash");
    await runResetDeactivation();
    try {
        sessionStorage.setItem(SPLASH_STORAGE_KEY, "1");
    } catch (error) { }
    window.location.reload();
}

function shutdownSystem() {
    if (!currentState.connected || !currentState.canShutdown || currentState.running || pendingCommand || shutdownRequested) return;
    if (!window.confirm("Desligar a VM? A IHM e o PLC serão encerrados.")) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showError("A comunicação com o servidor não está disponível.");
        return;
    }

    shutdownRequested = true;
    pendingCommand = "shutdown";
    clearError();
    showShutdownOverlay("Enviando comando de desligamento…");
    renderState();
    socket.send(JSON.stringify({ type: "command", command: "shutdown" }));
}

elements.btnStart.addEventListener("click", () => sendCommand("start"));
elements.btnStop.addEventListener("click", () => sendCommand("stop"));
elements.btnReset.addEventListener("click", () => sendCommand("reset"));
elements.btnResetApp.addEventListener("click", resetApplication);
elements.btnShutdown.addEventListener("click", shutdownSystem);

window.addEventListener("resize", ajustarLinhaParaTela);
window.addEventListener("beforeunload", () => window.clearTimeout(reconnectTimer));

resetBottles();
ajustarLinhaParaTela();
renderState();
startSplashFallback();
runStartupStages();
requestAnimationFrame(animateLine);
connect();
