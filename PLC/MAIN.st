PROGRAM MAIN
VAR
    fbStart : R_TRIG;
    fbStop : R_TRIG;
    fbReset : R_TRIG;

    tmInfeed : TON;
    tmSettle : TON;
    tmFill : TON;
    tmTransfer : TON;

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
    bFillDone := FALSE;
    bBeltStopped := FALSE;
    bFirstCycle := FALSE;
END_IF;

fbStart(CLK := GVL_HMI.bCmdStart);
fbStop(CLK := GVL_HMI.bCmdStop);
fbReset(CLK := GVL_HMI.bCmdReset);

IF fbStart.Q AND NOT GVL_HMI.bRunning THEN
    GVL_HMI.bRunning := TRUE;
    GVL_HMI.nFillPercent := 0;
    nStep := 0;
    bFillDone := FALSE;
    bBeltStopped := FALSE;
END_IF;

IF fbStop.Q THEN
    GVL_HMI.bRunning := FALSE;
    GVL_HMI.nFillPercent := 0;
    GVL_HMI.bSensorS1 := FALSE;
    nStep := 0;
    bFillDone := FALSE;
    bBeltStopped := FALSE;
END_IF;

IF fbReset.Q AND NOT GVL_HMI.bRunning THEN
    GVL_HMI.nBottlesFilled := 0;
    GVL_HMI.nProductionTotal := 0;
    GVL_HMI.nFillPercent := 0;
END_IF;

tmInfeed(IN := GVL_HMI.bRunning AND (nStep = 0), PT := T#3S270MS);
tmSettle(IN := GVL_HMI.bRunning AND (nStep = 1), PT := T#460MS);
tmFill(IN := GVL_HMI.bRunning AND (nStep = 2) AND NOT bFillDone, PT := T#2S);
tmTransfer(IN := GVL_HMI.bRunning AND (nStep = 3), PT := T#2S770MS);

IF GVL_HMI.bRunning THEN
    CASE nStep OF
        0:  (* Transporte inicial ate o sensor S1 *)
            GVL_HMI.bConveyorOn := TRUE;
            GVL_HMI.bSensorS1 := FALSE;
            IF tmInfeed.Q THEN
                nStep := 1;
            END_IF;

        1:  (* S1 acusa a presenca da garrafa; comanda a parada da esteira *)
            GVL_HMI.bConveyorOn := FALSE;
            GVL_HMI.bSensorS1 := TRUE;
            IF tmSettle.Q THEN
                bBeltStopped := TRUE;
                bFillDone := FALSE;
                GVL_HMI.nFillPercent := 0;
                nStep := 2;
            END_IF;

        2:  (* Esteira parada e S1 com garrafa: a EV atua *)
            GVL_HMI.bConveyorOn := FALSE;
            GVL_HMI.bSensorS1 := TRUE;

            IF tmFill.ET >= T#2S THEN
                GVL_HMI.nFillPercent := 100;
            ELSE
                GVL_HMI.nFillPercent := TO_USINT(TIME_TO_DINT(tmFill.ET) / 20);
            END_IF;

            IF tmFill.Q THEN
                GVL_HMI.nFillPercent := 100;
                GVL_HMI.nBottlesFilled := GVL_HMI.nBottlesFilled + 1;
                GVL_HMI.nProductionTotal := GVL_HMI.nProductionTotal + 1;
                bFillDone := TRUE;
                nStep := 3;
            END_IF;

        3:  (* Garrafa cheia: a esteira religa e a garrafa deixa o sensor *)
            GVL_HMI.bConveyorOn := TRUE;
            GVL_HMI.bSensorS1 := FALSE;
            IF tmTransfer.Q THEN
                bBeltStopped := FALSE;
                nStep := 1;
            END_IF;

        ELSE
            nStep := 0;
    END_CASE;
ELSE
    GVL_HMI.bConveyorOn := FALSE;
    GVL_HMI.bSensorS1 := FALSE;
    GVL_HMI.nFillPercent := 0;
    nStep := 0;
END_IF;

(* Garrafa no ponto de envase: S1 acusa a presenca e a esteira esta parada. *)
GVL_HMI.bBottlePositioned := GVL_HMI.bSensorS1 AND bBeltStopped;

(* Regra: a EV so atua se, e somente se, S1 acusa a garrafa e a esteira esta parada. *)
GVL_HMI.bEvInterlock := GVL_HMI.bSensorS1 AND bBeltStopped;
GVL_HMI.bEvOn := GVL_HMI.bRunning AND GVL_HMI.bEvInterlock AND NOT bFillDone;

(* Estacao AT removida nesta etapa (sem atuacao). *)
GVL_HMI.bAtOn := FALSE;
