export function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value)));
}

export function getPlcStatusPresentation(status) {
    if (status === "ready") {
        return { text: "Conectado (Run)", className: "ok" };
    }
    if (status === "stopped") {
        return { text: "Conectado (Stop)", className: "aviso" };
    }
    if (status === "offline" || status === "fault") {
        return { text: "Sem comunicação", className: "falha" };
    }
    return { text: "Verificando…", className: "aviso" };
}

export function getActiveStatus(active, available, activeText, inactiveText) {
    if (!available) return "—";
    return active ? activeText : inactiveText;
}

export function getEquipmentClass(active, available, blocked = false) {
    if (!available) return "";
    if (blocked) return "falha";
    return active ? "ok" : "";
}

export function getFillStatusText(state, plcReady) {
    if (!plcReady) return "Estado indisponível";
    if (state.evOn) return `Dosando: ${state.fillPercent}%`;
    if (state.bottlePositioned) return "Garrafa posicionada";
    if (state.sensorS1) return "S1 detectou garrafa";
    return "Aguardando S1";
}

export function getCapStatusText(state, plcReady) {
    if (!plcReady) return "Estado indisponível";
    if (state.atOn) return "Tampando garrafa";
    if (state.sensorS2) return "Garrafa em S2";
    return "Aguardando garrafa";
}

export function getMachineSummary(state, plcReady) {
    const status = state.plcStatus || "checking";
    if (status === "offline" || status === "fault") {
        return { text: "FALHA: sem comunicação com o PLC", className: "falha" };
    }
    if (state.evBlocked) {
        return { text: "FALHA: intertravamento da EV", className: "falha" };
    }
    if (state.atBlocked) {
        return { text: "FALHA: intertravamento da AT", className: "falha" };
    }
    if (status === "stopped") {
        return { text: "ATENÇÃO: runtime em Stop", className: "aviso" };
    }
    if (!plcReady || status === "checking") {
        return { text: "Verificando comunicação…", className: "aviso" };
    }
    return { text: "SISTEMA OK", className: "ok" };
}
