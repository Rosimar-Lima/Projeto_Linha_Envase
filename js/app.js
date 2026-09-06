let ligada = false;
let garrafas = [];
let producao = 0;

const container = document.getElementById("garrafas");
const contador = document.getElementById("contador");

const ESPACAMENTO = 140;
const VELOCIDADE = 2;

// -------------------------
// BOTÕES
// -------------------------

document.getElementById("btnLiga")
.addEventListener("click", () => {

    ligada = true;
});

document.getElementById("btnDesliga")
.addEventListener("click", () => {

    ligada = false;
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

    img.src = "images/Garrafa_Vazia.png";

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

    ligada = false;

    document.getElementById("enchedora")
        .style.background = "limegreen";

    console.log("ENVASE INICIADO");

    const enchimento = setInterval(() => {
        garrafa.nivel += 2;

        garrafa.liquido.style.height = garrafa.nivel + "%";

        if(garrafa.nivel >= 100){
            clearInterval(enchimento);
        
            garrafa.enchida = true;
            garrafa.enchendo = false;

            document.getElementById("enchedora")
                .style.background = "skyblue";

            console.log("ENVASE FINALIZADO");

            ligada = true;
        }

    }, 60);
}

//-------------------------
//TAMPAGEM    
//-------------------------

function iniciarTampagem(garrafa){
    
    ligada = false;

    document.getElementById("tampadora")
        .style.background = "red";

    console.log("TAMPAGEM INICIADA");
    
    setTimeout(() => {
        garrafa.tampada = true;
        garrafa.tampando = false;

        document.getElementById("tampadora")
            .style.background = "orange";

        console.log("TAMPAGEM FINALIZADA");

        ligada = true;

    }, 2000);
   }

// -------------------------
// PRIMEIRA GARRAFA
// -------------------------

criarGarrafa(20);

// -------------------------
// ANIMAÇÃO
// -------------------------

function animar(){

    if(ligada){

        garrafas.forEach(g => {

            // Detecta chegada na EV

            if(
                g.posicao >= 430 &&
                g.posicao <= 435 &&
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
                g.posicao >= 830 &&
                g.posicao <= 835 &&
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

        if(ultima.posicao > ESPACAMENTO){

            criarGarrafa(-140);
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