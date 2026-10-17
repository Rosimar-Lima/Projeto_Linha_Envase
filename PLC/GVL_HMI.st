{attribute 'qualified_only'}
VAR_GLOBAL
    bCmdStart : BOOL;
    bCmdStop : BOOL;
    bCmdReset : BOOL;

    bRunning : BOOL;
    bSensorS1 : BOOL;
    bSensorS2 : BOOL;
    bBottlePositioned : BOOL;
    bConveyorOn : BOOL;
    bEvOn : BOOL;
    bAtOn : BOOL;

    (* Intertravamento da valvula de envase (EV):
       S1 acusa a presenca da garrafa e a esteira esta parada. *)
    bEvInterlock : BOOL;

    (* Intertravamento da aplicadora de tampa (AT), espelhando a EV:
       S2 acusa a presenca da garrafa e a esteira esta parada. *)
    bAtInterlock : BOOL;

    nFillPercent : USINT;
    nBottlesFilled : UDINT;
    nBottlesCapped : UDINT;
    nProductionTotal : UDINT;
END_VAR
