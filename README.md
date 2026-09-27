# Projeto Simulador Linha de Envase

Simulador interativo de uma **Linha de Envase**, desenvolvido como parte do Projeto Multidisciplinar Final II – 10º semestre do curso de Engenharia Mecatrônica (UFBRA).

O objetivo é demonstrar conceitos de **JavaScript**, **HTML** e **CSS** aplicados ao controle de processos industriais, incluindo:

- Enchimento
- Tampagem
- Contadores de produção

---

## 🧩 Funcionalidades

- Simulação visual da linha de envase
- Controle do ciclo de enchimento e tampagem
- Contador automático de unidades Envasadas, Tampadas e Produzidas
- Interface simples e intuitiva para fins didáticos

---

## 🚀 Tecnologias Utilizadas

- **HTML5** – Estrutura da página
- **CSS3** – Estilização e layout
- **JavaScript** – Lógica da simulação e controle dos elementos

## IHM conectada ao TwinCAT

A WebApp pode ser executada como uma IHM local. O PLC fica responsável pelos comandos e contadores; o serviço Node.js faz a comunicação ADS e envia os estados à página por WebSocket.

### Requisitos

- Node.js e npm
- PLC TwinCAT em execução, com a lista `GVL_HMI` e as variáveis de comando/estado configuradas
- TwinCAT XAE/Router instalado no Windows, com uma rota ADS ativa para o TwinCAT/BSD

### Executar

No PowerShell, na pasta do projeto:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Abra `http://127.0.0.1:3000`. O arquivo `.env` permite configurar o AMS Net ID e a porta ADS do PLC. O serviço usa o roteador ADS local do TwinCAT XAE; por isso, a rota para a VM deve estar configurada e conectada no XAE. Os padrões do projeto são AMS Net ID `39.90.64.65.1.1` e porta PLC `851`.

O serviço espera os símbolos `GVL_HMI.bCmdStart`, `bCmdStop`, `bCmdReset`, `bRunning`, `nBottlesFilled`, `nBottlesCapped` e `nProductionTotal`. Se o nome da GVL ou das variáveis no projeto PLC for diferente, ajuste os caminhos em `server.js`.

Os estados das estações EV e AT ainda não são publicados pelo PLC; por isso a interface os identifica como indisponíveis, em vez de simular movimentos localmente.

A IHM diferencia a conexão ADS do estado do runtime PLC. Os comandos ficam habilitados somente quando o runtime está em `Run`; em `Stop` ou `Config`, a interface indica que o PLC está parado e bloqueia os comandos.

---
