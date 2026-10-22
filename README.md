# Projeto Linha de Envase

IHM web para uma **Linha de Envase** didática, desenvolvida como parte do Projeto Multidisciplinar Final II – 10º semestre do curso de Engenharia Mecatrônica (UFBRA).

O sistema integra uma interface web, uma ponte Node.js e um PLC TwinCAT. O PLC executa a sequência de transporte, envase e tampagem; a ponte lê os símbolos por ADS e publica o estado em tempo real para a IHM via WebSocket.

## 🧩 Funcionalidades

- Visualização da esteira, garrafas, sensores e estações EV/AT
- Comandos de ligar, desligar e zerar contadores
- Contadores de garrafas envasadas, tampadas e produção total
- Intertravamentos de segurança em três camadas (PLC, ponte e IHM)
- Tela de inicialização, reset da aplicação e desligamento da VM
- Exibição das versões da aplicação e do PLC

## 🚀 Tecnologias Utilizadas

- **PLC TwinCAT/BSD** – Sequência de controle em Structured Text (`MAIN.st` e `GVL_HMI.st`)
- **Node.js + Express** – Servidor HTTP e API WebSocket
- **ads-client** – Leitura e escrita de símbolos TwinCAT via ADS
- **HTML5 + CSS3** – Interface da IHM
- **JavaScript (ES Modules)** – Estado, animação e comunicação em tempo real

## 🗂️ Estrutura do projeto

```text
server.js              Entrada da ponte ADS/HTTP/WebSocket
src/config.js          Leitura e validação de .env/plc.config.json
src/state.js           Estado inicial, limites e intertravamentos
IHM/index.html         Estrutura da IHM
IHM/js/app.mjs         Comunicação, animação e eventos da IHM
IHM/js/status.mjs      Apresentação pura dos estados da máquina
PLC/MAIN.st            Ciclo de controle do PLC
PLC/GVL_HMI.st         Interface de variáveis entre PLC e IHM
deploy/                Bootstrap, serviço e autostart (BSD/Windows)
test/                  Testes unitários com node:test
```

## IHM conectada ao TwinCAT

A pasta `IHM` é o painel de máquina, onde o operador acompanha e manipula a produção de garrafas. O PLC fica responsável pelos comandos e contadores; o serviço Node.js faz a comunicação ADS e envia os estados à página por WebSocket.

### Requisitos

- Node.js e npm
- PLC TwinCAT em execução, com a lista `GVL_HMI` e as variáveis de comando/estado configuradas
- TwinCAT XAE/Router instalado no Windows, com uma rota ADS ativa para o TwinCAT/BSD

### Executar

No PowerShell, na pasta do projeto:

```powershell
npm install
npm test
npm start
```

Para desenvolvimento, use `npm run dev` (nodemon): reinicia o serviço automaticamente ao salvar `server.js`, `src/`, `plc.config.json` ou `.env`. Para validar a sintaxe sem iniciar o servidor, use `npm run check`. Em todos os casos, para parar aperte `Ctrl+C`.

Abra `http://127.0.0.1:3000`. Opcionalmente, crie um arquivo `.env` (não versionado) para sobrescrever os valores padrão: `HOST`, `PORT`, `ADS_TARGET_AMS_NET_ID`, `ADS_TARGET_PORT`, `ADS_TIMEOUT_MS`, `ADS_RECREATE_AFTER_MS`, `ADS_POLL_INTERVAL_MS` e `APP_VERSION`. Os padrões do projeto são AMS Net ID `39.90.64.65.1.1` e porta PLC `851`.

### Testes

`npm test` executa os testes com `node:test`, cobrindo configuração/ambiente, estado inicial, limites, intertravamentos e formatação dos estados da IHM. `npm run check` valida a sintaxe de todos os arquivos JavaScript do servidor e da IHM.

O serviço pode rodar em dois cenários:

- **Node dentro da VM TwinCAT/BSD (recomendado para o autostart):** a conexão ADS é local (mesma máquina); não há rota nem TwinCAT XAE no meio. O `.env` deve usar o AMS Net ID da própria VM e `HOST=0.0.0.0` para a IHM ser acessível pelo host Windows.
- **Node no host Windows:** usa o roteador ADS local do TwinCAT XAE; a rota para a VM precisa estar configurada e conectada no XAE.

A variável `ADS_POLL_INTERVAL_MS` (padrão `200`) define o intervalo de leitura do PLC. Ela **precisa ser bem menor que a menor etapa do ciclo** (`step1 = 460 ms`); com o valor antigo de `1000 ms` a IHM recebia o estado com até 1 s de atraso, a esteira saía de sincronia e a garrafa "saltava" até S1 a cada poucos ciclos.

O serviço espera os símbolos `GVL_HMI.bCmdStart`, `bCmdStop`, `bCmdReset`, `bRunning`, `bSensorS1`, `bSensorS2`, `bBottlePositioned`, `bConveyorOn`, `bEvOn`, `bAtOn`, `nFillPercent`, `nBottlesFilled` e `nBottlesCapped`; usa também `sPlcVersion` para exibir a versão do PLC (se ausente, mostra `—`). A produção total é calculada pela ponte como `min(envasadas, tampadas)`, ou seja, o número de garrafas que concluíram as duas etapas. Se o nome da GVL ou das variáveis no projeto PLC for diferente, ajuste os caminhos em `plc.config.json`.

O estado da estação EV (válvula de envase) é publicado pelo PLC via `bEvOn` e `nFillPercent`, e a interface o reflete em tempo real. A estação AT (aplicadora de tampa) publica `bSensorS2` (garrafa presente em S2), `bAtOn` (cilindro descendo/tampando) e `nBottlesCapped` (contador de tampadas).

### Estação AT (aplicadora de tampa)

Como as estações distam exatamente um passo de garrafa (S1 → S2 = 330 px), quando a esteira para para o envase em S1 há simultaneamente uma garrafa sob a AT em S2. O ciclo, portanto, aproveita a mesma parada:

1. A esteira para (bottle em S1 e bottle em S2).
2. A EV enche a garrafa de S1; a AT desce o cilindro (`bAtOn`) e tampa a garrafa de S2.
3. Terminada a tampagem (`nBottlesCapped` incrementa), o cilindro sobe e **a AT fica aguardando** — ela só volta a agir na próxima parada.
4. A esteira só religa quando o envase **e** a tampagem (se houver) terminam; a garrafa envasada avança para S2 e a próxima entra em S1.

Na primeira volta não há garrafa em S2, então a AT não atua; a partir da segunda, `bS2Occupied` fica verdadeiro e cada parada tampa a garrafa de S2.

A IHM diferencia a conexão ADS do estado do runtime PLC. Os comandos ficam habilitados somente quando o runtime está em `Run`; em `Stop` ou `Config`, a interface indica que o PLC está parado e bloqueia os comandos.

### Botões de sistema

Os dois botões retangulares amarelos ficam à direita do reset de contadores e só habilitam com a linha parada:

- **RESET APLICAÇÃO:** recarrega a IHM e exibe a tela de splash. Os serviços aparecem um a um conforme são desativados, enquanto a barra regride continuamente de 100% a 0%; há uma pausa de 3 s e depois os serviços reaparecem um a um com a barra subindo continuamente até 100% e o PLC responder. Não reinicia a VM, o serviço Node nem o PLC; portanto, a comunicação com a VM não é cortada.
- **DESLIGAR SISTEMA:** envia `shutdown -p now` para a VM (FreeBSD), encerrando a IHM, o TwinCAT e o sistema operacional. O serviço `linha_envase` precisa rodar como `root`; no host Windows o comando é recusado para não desligar o computador errado.

### Intertravamento da EV (segurança)

Regra: a válvula de envase (EV) só atua se, e somente se, o sensor S1 acusar a presença da garrafa **e** a esteira estiver parada. A regra é garantida em três camadas:

1. **PLC (`MAIN.st`)**: o ciclo avança por etapas (transporte inicial → S1 acusa a garrafa → esteira para e aguarda → envase → transporte). `GVL_HMI.bEvInterlock := bSensorS1 AND bBeltStopped` e a EV (`GVL_HMI.bEvOn`) só liga com `bRunning AND bEvInterlock AND NOT bFillDone`. Sem o intertravamento, a EV não abre.
2. **Ponte Node (`server.js` + `src/state.js`)**: antes de publicar, a ponte nunca envia `evOn = true` sem `bottlePositioned = true`. A tentativa é exposta em `evBlocked` e registrada no log.
3. **IHM (`IHM/js/app.mjs`)**: o enchimento só inicia com a garrafa exatamente sob a EV e, ao receber `bottlePositioned`, a garrafa é alinhada sob a válvula e a fila é congelada para manter o sincronismo. Enquanto a EV atua, a esteira fica travada. A verificação é silenciosa, sem mensagens na interface.

### Intertravamento da AT (segurança)

Regra: o cilindro da AT só desce com a garrafa presente em S2 **e** a esteira parada — a AT espelha a EV. O sensor S2 se comporta como o S1: acusa a presença enquanto a garrafa está na estação e desliga quando ela sai. A regra é garantida nas mesmas três camadas:

1. **PLC (`MAIN.st`)**: `GVL_HMI.bAtInterlock := bSensorS2 AND bBeltStopped` e a AT (`GVL_HMI.bAtOn`) só desce com `bRunning AND bAtInterlock AND NOT bCapped`. A tampagem conclui em `T#1S200MS` (antes do envase, de 2 s): o cilindro sobe e a AT aguarda a próxima parada.
2. **Ponte Node (`server.js` + `src/state.js`)**: antes de publicar, a ponte nunca envia `atOn = true` sem `sensorS2 = true`. A tentativa é exposta em `atBlocked` e registrada no log.
3. **IHM (`IHM/js/app.mjs`)**: a classe `.aplicando` faz o cilindro descer sobre a garrafa alinhada em S2; o sensor S2 acende quando há garrafa presente.

### Inicialização automática (autostart)

Cenário recomendado: **Node dentro da VM TwinCAT/BSD**, de modo que a IHM acompanhe o ciclo de vida da máquina — ao ligar a VM, a ponte sobe sozinha e a aplicação fica pronta assim que o PLC estiver em `Run`.

**Forma rápida — um comando só (do Windows):**

```powershell
pwsh -File deploy\windows\bootstrap-vm.ps1
# opcional: -VmHost 192.168.56.174 -User Administrator -AppDir /opt/linha-envase
```

O script envia por `scp` apenas os arquivos necessários para a VM (`server.js`, `src`, `IHM`, `PLC`, configuração e `deploy/bsd`), sem `node_modules`, `.git`, `logs`, `.env` ou o perfil do navegador do host, e roda o bootstrap na VM (`pkg install node` + `install.sh`). Prerequisito: a VM ter internet — se usar só adaptador *Host-Only*, adicione um 2º adaptador **NAT** no VirtualBox antes de rodar.

**Passos manuais na VM (como root; no TC/BSD use `doas`):**

```sh
# 1) copie o projeto, ex.: scp do Windows para ~ e mova para /opt
doas pkg install node       # Node.js + npm (confirmado node-24.x no repo TCBSD)
doas mv ~/linha-envase /opt/linha-envase
# 2) um script faz o resto (Node -> copia -> install):
doas APP_DIR=/opt/linha-envase sh /opt/linha-envase/deploy/bsd/bootstrap.sh
```

Para quem já copiou o projeto, `bootstrap.sh` apenas instala o Node (se faltar), copia para `APP_DIR` e chama o `install.sh`. O `install.sh` instala dependências, cria o `.env` a partir de `env.example` (revise `ADS_TARGET_AMS_NET_ID` com o AMS Net ID da própria VM e mantenha `HOST=0.0.0.0`), instala o serviço `linha_envase`, habilita (`enable=YES`) e inicia. Ele usa `daemon -r` (reinicia se cair) e grava em `/var/log/linha_envase.log`.

```sh
service linha_envase status
tail -f /var/log/linha_envase.log
```

Abra a IHM no host Windows em `http://<ip-da-vm>:3000`. Como a conexão ADS é local, não há rota nem XAE envolvidos — o autostart do boot project que você já configurou é suficiente.

**Notas do TwinCAT/BSD (importante):**

- **Firewall (`pf`):** o TC/BSD bloqueia a porta ADS **não criptografada 48898** para conexões externas por padrão; só o **Secure ADS (8016)** fica aberto. O `ads-client` (2.2.x) usa apenas ADS simples (48898). No cenário B a conexão é local (loopback) e normalmente passa; se o log acusar falha, rode o script que libera a porta e reinicia o serviço:

  ```sh
  doas sh /opt/linha-envase/deploy/bsd/fix-ads.sh
  ```

  (equivale a adicionar `pass in quick proto tcp to port 48898 synproxy state` em `/etc/pf.conf` e recarregar com `doas pfctl -f /etc/pf.conf`).

- **Internet na VM:** se a VM usa apenas adaptador *Host-Only*, ela não tem internet e o `pkg install` falha. Adicione um segundo adaptador em modo **NAT** (VirtualBox → Configurações → Rede → Adaptador 2 → NAT), instale o Node e, se quiser, remova depois.
- **Node:** disponível no repositório Beckhoff (`doas pkg install node`, confirmado `node-24.x`).

**Alternativa — Node no host Windows (roteador ADS do XAE, destino remoto):**

```powershell
pwsh -File deploy\windows\install-autostart.ps1                     # SYSTEM, no boot
pwsh -File deploy\windows\install-autostart.ps1 -Trigger AtLogOn    # usuario atual, no logon
```

O launcher (`deploy/windows/run-server.ps1`) mantém o processo vivo (reinicia se cair) e grava em `logs\server.log`. Remova com `deploy\windows\uninstall-autostart.ps1`. No modo `AtStartup` (SYSTEM) o projeto **não pode** ficar em pasta sincronizada do OneDrive; copie para algo como `C:\linha-envase`. Nesse cenário o `.env` aponta para o AMS Net ID da VM e a rota Windows ↔ BSD precisa estar ativa no XAE.

Em ambos os casos a ponte já reconecta sozinha via ADS; os scripts apenas garantem que o processo esteja no ar desde o boot.

**Tela de inicialização (splash):**

O watcher do host (`deploy/host/watch-vm.ps1`) abre `deploy/host/splash.html` em kiosk quando a VM sobe. O rodapé mostra horário, data e versões. A versão da aplicação vem do campo `version` em `package.json`; a versão do PLC vem da variável `GVL_HMI.sPlcVersion`, lida por ADS. A splash e a IHM exibem os dois valores recebidos do servidor.

O único valor configurável no host fica em `deploy/host/splash.config.json`:

```json
{
    "timeZone": ""
}
```

`timeZone` vazio usa o fuso do host; para fixar o horário/data exibidos, informe um nome IANA (ex.: `America/Sao_Paulo`). O watcher relê o JSON a cada subida da VM, sem precisar reinstalar a tarefa.

**Controle de versões:** para a aplicação, altere `version` em `package.json` e `package-lock.json` e reinicie o serviço; para o PLC, altere `GVL_HMI.sPlcVersion` em `PLC/GVL_HMI.st` e faça o download do projeto para o runtime. O servidor relê a versão do PLC ao reconectar e, no máximo, a cada 60 segundos.
