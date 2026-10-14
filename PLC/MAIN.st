PROGRAM MAIN
VAR
    fbStart : R_TRIG;
    fbStop : R_TRIG;
    fbReset : R_TRIG;

    (* Relogio livre, avanca sempre (inclusive com a linha parada). Serve para
       medir o dt da tarefa, permitindo cronometrar as etapas de forma pausavel. *)
    tonClock : TON;
    tClockPrev : TIME;
    tDelta : TIME;

    (* Tempo decorrido da etapa atual. Avanca somente com a linha ligada: o Off
       congela e o On retoma do mesmo ponto (cronometro pausado). *)
    tStep : TIME;
    nStepPrev : USINT := 255;

    nStep : USINT := 0;
    bFirstCycle : BOOL := TRUE;
    bFillDone : BOOL := FALSE;
    bBeltStopped : BOOL := FALSE;
END_VAR

IF bFirstCycle THEN
    GVL_HMI.bCmdStart := FALSE;
    GVL_HMI.bCmdStop := FALSE;
    GVL_HMI.bCmdReset := FALSE;
    GVL_HMI.bRunning := FALSE;
    GVL_HMI.bSensorS1 := FALSE;
    GVL_HMI.bBottlePositioned := FALSE;
    GVL_HMI.bConveyorOn := FALSE;
    GVL_HMI.bEvOn := FALSE;
    GVL_HMI.bAtOn := FALSE;
    GVL_HMI.bEvInterlock := FALSE;
    GVL_HMI.nFillPercent := 0;
    nStep := 0;
    nStepPrev := 255;
    tStep := T#0MS;
    tClockPrev := T#0MS;
    bFillDone := FALSE;
    bBeltStopped := FALSE;
    bFirstCycle := FALSE;
END_IF

fbStart(CLK := GVL_HMI.bCmdStart);
fbStop(CLK := GVL_HMI.bCmdStop);
fbReset(CLK := GVL_HMI.bCmdReset);

(* Relogio livre para medir o tempo de ciclo da tarefa. *)
tonClock(IN := TRUE, PT := T#49D17H2M47S295MS);
IF tonClock.ET >= tClockPrev THEN
    tDelta := tonClock.ET - tClockPrev;
ELSE
    tDelta := T#0MS;
END_IF
tClockPrev := tonClock.ET;

(* On: retoma do ponto onde parou. NAO reinicia a sequencia. *)
IF fbStart.Q AND NOT GVL_HMI.bRunning THEN
    GVL_HMI.bRunning := TRUE;
END_IF

(* Off: pausa. Preserva etapa, tempo, nivel de envase e sinal de S1. *)
IF fbStop.Q THEN
    GVL_HMI.bRunning := FALSE;
END_IF

(* Reset: somente com a linha parada. Zera contadores e prepara o reinicio. *)
IF fbReset.Q AND NOT GVL_HMI.bRunning THEN
    GVL_HMI.nBottlesFilled := 0;
    GVL_HMI.nProductionTotal := 0;
    GVL_HMI.nFillPercent := 0;
    nStep := 0;
    nStepPrev := 255;
    tStep := T#0MS;
    bFillDone := FALSE;
    bBeltStopped := FALSE;
    GVL_HMI.bSensorS1 := FALSE;
    GVL_HMI.bConveyorOn := FALSE;
END_IF

(* Ao entrar numa etapa, o tempo dessa etapa reinicia. *)
IF nStep <> nStepPrev THEN
    tStep := T#0MS;
    nStepPrev := nStep;
END_IF

(* O tempo da etapa so avanca com a linha ligada. *)
IF GVL_HMI.bRunning THEN
    tStep := tStep + tDelta;
END_IF

IF GVL_HMI.bRunning THEN
    CASE nStep OF
        0:  (* Transporte inicial ate o sensor S1 *)
            GVL_HMI.bConveyorOn := TRUE;
            GVL_HMI.bSensorS1 := FALSE;
            IF tStep >= T#3S270MS THEN
                nStep := 1;
            END_IF

        1:  (* S1 acusa a presenca da garrafa; comanda a parada da esteira *)
            GVL_HMI.bConveyorOn := FALSE;
            GVL_HMI.bSensorS1 := TRUE;
            IF tStep >= T#460MS THEN
                bBeltStopped := TRUE;
                bFillDone := FALSE;
                GVL_HMI.nFillPercent := 0;
                nStep := 2;
            END_IF

        2:  (* Esteira parada e S1 com garrafa: a EV atua *)
            GVL_HMI.bConveyorOn := FALSE;
            GVL_HMI.bSensorS1 := TRUE;

            IF tStep >= T#2S THEN
                GVL_HMI.nFillPercent := 100;
                GVL_HMI.nBottlesFilled := GVL_HMI.nBottlesFilled + 1;
                GVL_HMI.nProductionTotal := GVL_HMI.nProductionTotal + 1;
                bFillDone := TRUE;
                nStep := 3;
            ELSE
                GVL_HMI.nFillPercent := TO_USINT(TIME_TO_DINT(tStep) / 20);
            END_IF

        3:  (* Garrafa cheia: a esteira religa e a garrafa deixa o sensor *)
            GVL_HMI.bConveyorOn := TRUE;
            GVL_HMI.bSensorS1 := FALSE;
            IF tStep >= T#2S770MS THEN
                bBeltStopped := FALSE;
                nStep := 1;
            END_IF

        ELSE
            nStep := 0;
    END_CASE
ELSE
    (* Pausado: corta as saidas de movimento, mas preserva nStep, tStep,
       bFillDone, bBeltStopped, bSensorS1 e nFillPercent para retomar. *)
    GVL_HMI.bConveyorOn := FALSE;
END_IF

(* Garrafa no ponto de envase: S1 acusa a presenca e a esteira esta parada. *)
GVL_HMI.bBottlePositioned := GVL_HMI.bSensorS1 AND bBeltStopped;

(* Regra: a EV so atua se, e somente se, S1 acusa a garrafa e a esteira esta parada. *)
GVL_HMI.bEvInterlock := GVL_HMI.bSensorS1 AND bBeltStopped;
GVL_HMI.bEvOn := GVL_HMI.bRunning AND GVL_HMI.bEvInterlock AND NOT bFillDone;

(* Estacao AT removida nesta etapa (sem atuacao). *)
GVL_HMI.bAtOn := FALSE;
