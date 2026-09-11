let ligada = false;
let garrafas = [];
let producao = 0;
let envaseConcluido = false;
let tampagemConcluida =false;

const container = document.getElementById("garrafas");
const contador = document.getElementById("contador");

window.onload = () => {

    const ev = document.getElementById("enchedora");
    const st = document.getElementById("tampadora");

};

const POS_EV = 405;
const POS_ST = 735;

const ESPACAMENTO = 330;

const VELOCIDADE = 5;

// -------------------------
// BOTÕES
// -------------------------

document.getElementById("btnLiga")
.addEventListener("click", async () => {

    try {

        const resposta =
            await fetch(
                'http://localhost:3000/liga'
            );

        const dados =
            await resposta.json();

        console.log(dados);

    }

    catch(err){

        console.error(err);

    }

});

document.getElementById("btnDesliga")
.addEventListener("click", async () => {

    try {

        const resposta =
            await fetch(
                'http://localhost:3000/desliga'
            );

        const dados =
            await resposta.json();

        console.log(dados);

    }

    catch(err){

        console.error(err);

    }

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

        tampando: false,
        tampada: false,

        contabilizada: false,

        nivel: 0
        
    });
}



// -------------------------
// ENVASE
// -------------------------

function iniciarEnvase(garrafa){
    
    console.log("EV", garrafa.posicao);

    ligada = false;

    document.getElementById("enchedora")
        .classList.add("operando");

    console.log("ENVASE INICIADO");

    const enchimento = setInterval(() => {
        garrafa.nivel += 2;

        garrafa.liquido.style.height = garrafa.nivel + "%";

        if(garrafa.nivel >= 85){
            clearInterval(enchimento);
        
            garrafa.enchida = true;
            garrafa.enchendo = false;

            document.getElementById("enchedora")
                .classList.remove("operando");

            console.log("ENVASE FINALIZADO");

            ligada = true;

                       
            
        }

    }, 60);
}



//-------------------------
//TAMPAGEM    
//-------------------------

function iniciarTampagem(garrafa){
    console.log("ST", garrafa.posicao);
    
    ligada = false;

    document.getElementById("tampadora")
        .classList.add("operando");

    console.log("TAMPAGEM INICIADA");
    
    setTimeout(() => {
        garrafa.tampada = true;
        garrafa.tampando = false;

        document.getElementById("tampadora")
            .classList.remove("operando");

        console.log("TAMPAGEM FINALIZADA");

        ligada = true;

    

    }, 2600);
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

    if(ligada){

        garrafas.forEach(g => {

            // Detecta chegada na EV

            if(
                g.posicao >= POS_EV - 5 &&
                g.posicao <= POS_EV &&
                !g.enchendo &&
                !g.enchida
            ){

                g.enchendo = true;

                iniciarEnvase(g);
            }

            // Movimenta somente se não estiver enchendo

            if(
                !g.enchendo &&
                !g.tampando
            ){

                g.posicao += VELOCIDADE;

                g.container.style.left =
                    g.posicao + "px";
            }
            

            // Detecta chegada na ST

            if(
                g.posicao >= POS_ST - 5 &&
                g.posicao <= POS_ST &&
                !g.tampando &&
                g.enchida &&
                !g.tampada
            ){

                g.tampando = true;

                iniciarTampagem(g);
            }

            // Atualiza contador

            if(
                g.tampada &&
                !g.contabilizada

            ){
                g.contabilizada = true;
                producao++;
                contador.innerText = producao;
            }
        });

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

async function atualizarPLC(){

    try{

        const resposta =
            await fetch(
                'http://localhost:3000/status'
            );

        const dados =
            await resposta.json();

        ligada = dados.motor;
        contador.innerText =
            dados.producao;

        contador.innerText =
            dados.producao;

        const ev =
            document.getElementById(
                "enchedora"
            );

        const st =
            document.getElementById(
                "tampadora"
            );

        if(dados.ev){

            ev.classList.add(
                "operando"
            );

        }else{

            ev.classList.remove(
                "operando"
            );

        }

        if(dados.st){

            st.classList.add(
                "operando"
            );

        }else{

            st.classList.remove(
                "operando"
            );

        }

    }

    catch(err){

        console.error(err);

    }

}


setInterval(
    atualizarPLC,
    1000
);