import test from "node:test";
import assert from "node:assert/strict";
import {
    clampPercent,
    getActiveStatus,
    getCapStatusText,
    getEquipmentClass,
    getFillStatusText,
    getMachineSummary,
    getPlcStatusPresentation
} from "../IHM/js/status.mjs";

const BASE_STATE = Object.freeze({
    plcStatus: "ready",
    evOn: false,
    evBlocked: false,
    atOn: false,
    atBlocked: false,
    bottlePositioned: false,
    sensorS1: false,
    sensorS2: false,
    fillPercent: 0
});

test("limita o percentual de envase", () => {
    assert.equal(clampPercent(-5), 0);
    assert.equal(clampPercent(50), 50);
    assert.equal(clampPercent(150), 100);
});

test("apresenta os estados possíveis do PLC", () => {
    assert.deepEqual(getPlcStatusPresentation("ready"), { text: "Conectado (Run)", className: "ok" });
    assert.deepEqual(getPlcStatusPresentation("stopped"), { text: "Conectado (Stop)", className: "aviso" });
    assert.deepEqual(getPlcStatusPresentation("offline"), { text: "Sem comunicação", className: "falha" });
    assert.deepEqual(getPlcStatusPresentation("fault"), { text: "Sem comunicação", className: "falha" });
    assert.deepEqual(getPlcStatusPresentation("checking"), { text: "Verificando…", className: "aviso" });
});

test("formata valores ativos e indisponíveis", () => {
    assert.equal(getActiveStatus(true, true, "Ligada", "Desligada"), "Ligada");
    assert.equal(getActiveStatus(false, true, "Ligada", "Desligada"), "Desligada");
    assert.equal(getActiveStatus(true, false, "Ligada", "Desligada"), "—");
});

test("define as classes dos equipamentos", () => {
    assert.equal(getEquipmentClass(true, true), "ok");
    assert.equal(getEquipmentClass(false, true), "");
    assert.equal(getEquipmentClass(true, false), "");
    assert.equal(getEquipmentClass(false, true, true), "falha");
    assert.equal(getEquipmentClass(true, false, true), "");
});

test("descreve o estado da EV", () => {
    assert.equal(getFillStatusText(BASE_STATE, false), "Estado indisponível");
    assert.equal(getFillStatusText({ ...BASE_STATE, evOn: true, fillPercent: 42 }, true), "Dosando: 42%");
    assert.equal(getFillStatusText({ ...BASE_STATE, bottlePositioned: true }, true), "Garrafa posicionada");
    assert.equal(getFillStatusText({ ...BASE_STATE, sensorS1: true }, true), "S1 detectou garrafa");
    assert.equal(getFillStatusText(BASE_STATE, true), "Aguardando S1");
});

test("descreve o estado da AT", () => {
    assert.equal(getCapStatusText(BASE_STATE, false), "Estado indisponível");
    assert.equal(getCapStatusText({ ...BASE_STATE, atOn: true }, true), "Tampando garrafa");
    assert.equal(getCapStatusText({ ...BASE_STATE, sensorS2: true }, true), "Garrafa em S2");
    assert.equal(getCapStatusText(BASE_STATE, true), "Aguardando garrafa");
});

test("resume a máquina com a prioridade correta", () => {
    assert.deepEqual(
        getMachineSummary({ ...BASE_STATE, plcStatus: "offline", evBlocked: true }, false),
        { text: "FALHA: sem comunicação com o PLC", className: "falha" }
    );
    assert.deepEqual(
        getMachineSummary({ ...BASE_STATE, evBlocked: true }, true),
        { text: "FALHA: intertravamento da EV", className: "falha" }
    );
    assert.deepEqual(
        getMachineSummary({ ...BASE_STATE, atBlocked: true }, true),
        { text: "FALHA: intertravamento da AT", className: "falha" }
    );
    assert.deepEqual(
        getMachineSummary({ ...BASE_STATE, plcStatus: "stopped" }, false),
        { text: "ATENÇÃO: runtime em Stop", className: "aviso" }
    );
    assert.deepEqual(
        getMachineSummary({ ...BASE_STATE, plcStatus: "checking" }, false),
        { text: "Verificando comunicação…", className: "aviso" }
    );
    assert.deepEqual(
        getMachineSummary(BASE_STATE, true),
        { text: "SISTEMA OK", className: "ok" }
    );
});
