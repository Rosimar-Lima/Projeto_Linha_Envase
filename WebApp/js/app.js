let ligada = false;
let evRecuando = false;
let offPressionado = false;
let garrafas = [];
let garrafasEnvasadas = 0;
let garrafasTampadas = 0;
let producaoTotal = 0;
let envaseConcluido = false;
let aplicacaoConcluida = false;

const container = document.getElementById("garrafas");
const contadorEnvasadas = document.getElementById("contadorEnvasadas");
const contadorTampadas = document.getElementById("contadorTampadas");
const contadorTotal = document.getElementById("contadorTotal");
const btnInstrucoes = document.getElementById("btnInstrucoes");
const opcoesInstrucoes = document.getElementById("opcoesInstrucoes");
const painelInstrucoes = document.getElementById("painelInstrucoes");
const textoInstrucao = document.getElementById("textoInstrucao");
const linhaViewport = document.getElementById("linhaViewport");
const linha = document.getElementById("linha");

function ajustarLinhaParaTela(){
    const escala = Math.min(1, linhaViewport.clientWidth / 1200);
    linha.style.transform = `scale(${escala})`;
    linhaViewport.style.height = `${380 * escala}px`;
}

window.addEventListener("resize", ajustarLinhaParaTela);
ajustarLinhaParaTela();

window.onload = () => {

    const ev = document.getElementById("enchedora");
    const at = document.getElementById("aplicadora");

};

const POS_EV = 388;
const POS_AT = 733;

const ESPACAMENTO = POS_AT - POS_EV;

const VELOCIDADE = 5;
const TEMPO_ENVASE = Math.ceil(85 / 2) * 60;

// -------------------------
// BOTÕES
// -------------------------

document.getElementById("btnLiga")
.addEventListener("click", () => {

    ligada = true;
    offPressionado = false;

});

document.getElementById("btnDesliga")
.addEventListener("click", () => {

    ligada = false;
    offPressionado = true;

});

document.getElementById("btnReset")
.addEventListener("click", () => {

    if(!offPressionado){
        return;
    }

    garrafasEnvasadas = 0;
    garrafasTampadas = 0;
    producaoTotal = 0;
    atualizarContadores();

    garrafas.forEach(garrafa => {

        clearInterval(garrafa.enchimentoInterval);
        clearTimeout(garrafa.envaseDescidaTimeout);
        clearTimeout(garrafa.envaseRecuoTimeout);
        clearTimeout(garrafa.aplicacaoDescidaTimeout);
        clearTimeout(garrafa.aplicacaoTimeout);
        clearTimeout(garrafa.aplicacaoRecuoTimeout);
        garrafa.container.remove();

    });

    garrafas = [];
    document.getElementById("enchedora")
        .classList.remove("operando");
    document.getElementById("enchedora")
        .classList.remove("recuando");
    evRecuando = false;
    document.querySelector("#statusEnvase span")
        .innerText = "ENVASE OFF";
    document.getElementById("aplicadora")
        .classList.remove("operando");
    document.getElementById("aplicadora")
        .classList.remove("recuando");
    document.getElementById("aplicadora")
        .classList.remove("descendo");
    document.getElementById("aplicadora")
        .classList.remove("abaixada");

    criarGarrafa(20);
    criarGarrafa(20 - ESPACAMENTO);

});

btnInstrucoes.addEventListener("click", () => {
    const aberto = !opcoesInstrucoes.hidden;
    opcoesInstrucoes.hidden = aberto;
    painelInstrucoes.hidden = aberto;
    if(aberto){
        textoInstrucao.innerText = "";
    }
    btnInstrucoes.setAttribute("aria-expanded", String(!aberto));
});

document.getElementById("instrucaoOn")
.addEventListener("click", () => {
    textoInstrucao.innerText = "On: Pressione este comando para iniciar o movimento das garrafas na linha de envase.";
    painelInstrucoes.hidden = false;
});

document.getElementById("instrucaoOff")
.addEventListener("click", () => {
    textoInstrucao.innerText = "Off: Pressione este comando para interromper o movimento das garrafas na linha de envase.";
    painelInstrucoes.hidden = false;
});

document.getElementById("instrucaoReset")
.addEventListener("click", () => {
    textoInstrucao.innerText = "Reset: Pressione este comando para zerar os contadores e reposicionar as garrafas.";
    painelInstrucoes.hidden = false;
});

// -------------------------
// CRIAÇÃO DE GARRAFA
// -------------------------

function criarGarrafa(posicaoInicial){

    const containerGarrafa = document.createElement("div");

    containerGarrafa.className = "garrafaContainer";

    containerGarrafa.style.left = posicaoInicial + "px";

    const liquido = document.createElement("div");

    liquido.className = "liquido";

    const img = document.createElement("img");

    img.src = "images/garrafa vazia.png";

    containerGarrafa.appendChild(liquido);
    containerGarrafa.appendChild(img);

    container.appendChild(containerGarrafa);

    garrafas.push({
        container: containerGarrafa,
        elemento: img,
        liquido: liquido,

        posicao: posicaoInicial,

        enchendo: false,
        enchida: false,
        envaseContabilizado: false,
        evBloqueada: false,
        envaseDescidaTimeout: null,
        enchimentoInterval: null,
        envaseRecuoTimeout: null,

        aplicando: false,
        tampaAplicada: false,
        tampaContabilizada: false,
        atBloqueada: false,
        aplicacaoDescidaTimeout: null,
        aplicacaoTimeout: null,
        aplicacaoRecuoTimeout: null,

        contabilizada: false,

        nivel: 0
        
    });
}



// -------------------------
// ENVASE
// -------------------------

function iniciarEnvase(garrafa){
    
    console.log("EV", garrafa.posicao);

    const enchedora = document.getElementById("enchedora");
    const statusEnvase = document.querySelector("#statusEnvase span");
    garrafa.evBloqueada = true;
    enchedora.classList.add("operando");
    statusEnvase.innerText = "ENVASE OFF";

    console.log("ENVASE INICIADO");

    garrafa.envaseDescidaTimeout = setTimeout(() => {
        garrafa.envaseDescidaTimeout = null;
        statusEnvase.innerText = "ENVASE ON";
        garrafa.enchimentoInterval = setInterval(() => {
            garrafa.nivel += 2;

            garrafa.liquido.style.height = garrafa.nivel + "%";

            if(garrafa.nivel >= 85){
                clearInterval(garrafa.enchimentoInterval);
                garrafa.enchimentoInterval = null;
                garrafa.enchida = true;
                garrafa.enchendo = false;

                if(!garrafa.envaseContabilizado){
                    garrafa.envaseContabilizado = true;
                    garrafasEnvasadas++;
                    atualizarContadores();
                }

                enchedora.classList.remove("operando");
                enchedora.classList.add("recuando");
                evRecuando = true;
                statusEnvase.innerText = "ENVASE OFF";

                console.log("ENVASE FINALIZADO");

                garrafa.envaseRecuoTimeout = setTimeout(() => {
                    enchedora.classList.remove("recuando");
                    garrafa.envaseRecuoTimeout = null;
                    evRecuando = false;
                    garrafa.evBloqueada = false;
                }, 750);
            }
        }, 60);
    }, 700);

}


// APLICAÇÃO DA TAMPA
// -------------------------

function iniciarAplicacao(garrafa){
    console.log("AT", garrafa.posicao);

    const aplicadora = document.getElementById("aplicadora");
    garrafa.atBloqueada = true;
    aplicadora.classList.add("operando");
    aplicadora.classList.add("descendo");
    console.log("APLICAÇÃO INICIADA");

    garrafa.aplicacaoDescidaTimeout = setTimeout(() => {
        garrafa.aplicacaoDescidaTimeout = null;
        aplicadora.classList.remove("descendo");
        aplicadora.classList.add("abaixada");

        garrafa.aplicacaoTimeout = setTimeout(() => {
            garrafa.tampaAplicada = true;
            garrafa.aplicando = false;
            garrafa.atBloqueada = true;
            garrafa.aplicacaoTimeout = null;

            if(!garrafa.tampaContabilizada){
                garrafa.tampaContabilizada = true;
                garrafasTampadas++;
                producaoTotal++;
                atualizarContadores();
            }
            aplicadora.classList.remove("operando");
            aplicadora.classList.remove("abaixada");
            aplicadora.classList.add("recuando");
            console.log("APLICAÇÃO FINALIZADA");

            garrafa.aplicacaoRecuoTimeout = setTimeout(() => {
                aplicadora.classList.remove("recuando");
                garrafa.aplicacaoRecuoTimeout = null;
                garrafa.atBloqueada = false;
            }, 750);
        }, TEMPO_ENVASE);
    }, 700);
}

function atualizarContadores(){
    contadorEnvasadas.innerText = garrafasEnvasadas;
    contadorTampadas.innerText = garrafasTampadas;
    contadorTotal.innerText = producaoTotal;
}

// -------------------------
// PRIMEIRA GARRAFA
// -------------------------

criarGarrafa(20);
criarGarrafa(20 - ESPACAMENTO);

// -------------------------
// ANIMAÇÃO
// -------------------------

function animar(){

    garrafas.forEach(g => {

            // Detecta chegada na EV

            if(
                g.posicao >= POS_EV - 5 &&
                g.posicao <= POS_EV &&
                !g.enchendo &&
                !g.enchida
            ){

                g.posicao = POS_EV;
                g.container.style.left = g.posicao + "px";
                g.enchendo = true;

                iniciarEnvase(g);
            }

            // Movimenta somente se não estiver enchendo

            const garrafaAFrente = garrafas
                .filter(outra => outra.posicao > g.posicao)
                .sort((a, b) => a.posicao - b.posicao)[0];
            const distanciaSegura = !garrafaAFrente ||
                g.posicao + VELOCIDADE <= garrafaAFrente.posicao - ESPACAMENTO;
            if(
                ligada &&
                !g.enchendo &&
                !g.aplicando &&
                !g.evBloqueada &&
                !g.atBloqueada &&
                distanciaSegura
            ){

                g.posicao += VELOCIDADE;

                g.container.style.left =
                    g.posicao + "px";
            }
            

            // Detecta chegada na AT

            if(
                g.posicao >= POS_AT - VELOCIDADE * 2 &&
                g.posicao <= POS_AT + VELOCIDADE &&
                !g.aplicando &&
                g.enchida &&
                !g.tampaAplicada
            ){

                g.posicao = POS_AT;
                g.container.style.left = g.posicao + "px";
                g.aplicando = true;

                iniciarAplicacao(g);
            }

    });

    if(ligada){

        // Cria novas garrafas

        const ultima =
            garrafas[garrafas.length - 1];

        if(ultima.posicao >=20){

            criarGarrafa(
                ultima.posicao - ESPACAMENTO);
            
        }

        // Remove garrafas fora da tela

        garrafas = garrafas.filter(g => {

            if(g.posicao > 1300){

                g.container.remove();

                return false;
            }

            return true;

        });

    }

    requestAnimationFrame(animar);
}

animar();

