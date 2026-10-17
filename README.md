# Projeto Simulador Linha de Envase

Simulador interativo de uma **Linha de Envase**, desenvolvido como parte do Projeto Multidisciplinar Final II – 10º semestre do curso de Engenharia Mecatrônica (UFBRA).

O objetivo é demonstrar conceitos de **JavaScript**, **HTML** e **CSS** aplicados ao controle de processos industriais, incluindo:

- Enchimento
- Contadores de produção

---

## 🧩 Funcionalidades

- Simulação visual da linha de envase
- Controle do ciclo de enchimento
- Contador automático de unidades Envasadas e Produzidas
- Interface simples e intuitiva para fins didáticos

---

## 🚀 Tecnologias Utilizadas

- **HTML5** – Estrutura da página
- **CSS3** – Estilização e layout
- **JavaScript** – Lógica da simulação e controle dos elementos

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
npm start
```

Para desenvolvimento, use `npm run dev` (nodemon): reinicia o serviço automaticamente ao salvar `server.js` ou `.env`. Em ambos os casos, para parar aperte `Ctrl+C`.

Abra `http://127.0.0.1:3000`. Opcionalmente, crie um arquivo `.env` (não versionado) para sobrescrever os valores padrão: `HOST`, `PORT`, `ADS_TARGET_AMS_NET_ID`, `ADS_TARGET_PORT` e `ADS_POLL_INTERVAL_MS`. O serviço usa o roteador ADS local do TwinCAT XAE; por isso, a rota para a VM deve estar configurada e conectada no XAE. Os padrões do projeto são AMS Net ID `39.90.64.65.1.1` e porta PLC `851`.

A variável `ADS_POLL_INTERVAL_MS` (padrão `200`) define o intervalo de leitura do PLC. Ela **precisa ser bem menor que a menor etapa do ciclo** (`step1 = 460 ms`); com o valor antigo de `1000 ms` a IHM recebia o estado com até 1 s de atraso, a esteira saía de sincronia e a garrafa "saltava" até S1 a cada poucos ciclos.

O serviço espera os símbolos `GVL_HMI.bCmdStart`, `bCmdStop`, `bCmdReset`, `bRunning`, `bSensorS1`, `bSensorS2`, `bBottlePositioned`, `bConveyorOn`, `bEvOn`, `bAtOn`, `nFillPercent`, `nBottlesFilled`, `nBottlesCapped` e `nProductionTotal`. Se o nome da GVL ou das variáveis no projeto PLC for diferente, ajuste os caminhos em `server.js`.

O estado da estação EV (válvula de envase) é publicado pelo PLC via `bEvOn` e `nFillPercent`, e a interface o reflete em tempo real. A estação AT (aplicadora de tampa) publica `bSensorS2` (garrafa presente em S2), `bAtOn` (cilindro descendo/tampando) e `nBottlesCapped` (contador de tampadas).

### Estação AT (aplicadora de tampa)

Como as estações distam exatamente um passo de garrafa (S1 → S2 = 330 px), quando a esteira para para o envase em S1 há simultaneamente uma garrafa sob a AT em S2. O ciclo, portanto, aproveita a mesma parada:

1. A esteira para (bottle em S1 e bottle em S2).
2. A EV enche a garrafa de S1; a AT desce o cilindro (`bAtOn`) e tampa a garrafa de S2.
3. Terminada a tampagem (`nBottlesCapped` incrementa), o cilindro sobe e **a AT fica aguardando** — ela só volta a agir na próxima parada.
4. A esteira só religa quando o envase **e** a tampagem (se houver) terminam; a garrafa envasada avança para S2 e a próxima entra em S1.

Na primeira volta não há garrafa em S2, então a AT não atua; a partir da segunda, `bS2Occupied` fica verdadeiro e cada parada tampa a garrafa de S2.

A IHM diferencia a conexão ADS do estado do runtime PLC. Os comandos ficam habilitados somente quando o runtime está em `Run`; em `Stop` ou `Config`, a interface indica que o PLC está parado e bloqueia os comandos.

### Intertravamento da EV (segurança)

Regra: a válvula de envase (EV) só atua se, e somente se, o sensor S1 acusar a presença da garrafa **e** a esteira estiver parada. A regra é garantida em três camadas:

1. **PLC (`MAIN.st`)**: o ciclo avança por etapas (transporte inicial → S1 acusa a garrafa → esteira para e aguarda → envase → transporte). `GVL_HMI.bEvInterlock := bSensorS1 AND bBeltStopped` e a EV (`GVL_HMI.bEvOn`) só liga com `bRunning AND bEvInterlock AND NOT bFillDone`. Sem o intertravamento, a EV não abre.
2. **Ponte Node (`server.js`)**: antes de publicar, a ponte nunca envia `evOn = true` sem `bottlePositioned = true`. A tentativa é exposta em `evBlocked` e registrada no log.
3. **IHM (`IHM/js/app.js`)**: o enchimento só inicia com a garrafa exatamente sob a EV e, ao receber `bottlePositioned`, a garrafa é alinhada sob a válvula e a fila é congelada para manter o sincronismo. Enquanto a EV atua, a esteira fica travada. A verificação é silenciosa, sem mensagens na interface.

### Intertravamento da AT (segurança)

Regra: o cilindro da AT só desce com a garrafa presente em S2 **e** a esteira parada — a AT espelha a EV. O sensor S2 se comporta como o S1: acusa a presença enquanto a garrafa está na estação e desliga quando ela sai. A regra é garantida nas mesmas três camadas:

1. **PLC (`MAIN.st`)**: `GVL_HMI.bAtInterlock := bSensorS2 AND bBeltStopped` e a AT (`GVL_HMI.bAtOn`) só desce com `bRunning AND bAtInterlock AND NOT bCapped`. A tampagem conclui em `T#1S200MS` (antes do envase, de 2 s): o cilindro sobe e a AT aguarda a próxima parada.
2. **Ponte Node (`server.js`)**: antes de publicar, a ponte nunca envia `atOn = true` sem `sensorS2 = true`. A tentativa é exposta em `atBlocked` e registrada no log.
3. **IHM (`IHM/js/app.js`)**: a classe `.aplicando` faz o cilindro descer sobre a garrafa alinhada em S2; o sensor S2 acende quando há garrafa presente.
