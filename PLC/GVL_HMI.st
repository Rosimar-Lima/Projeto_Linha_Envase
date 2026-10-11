{attribute 'qualified_only'}
VAR_GLOBAL
    bCmdStart : BOOL;
    bCmdStop : BOOL;
    bCmdReset : BOOL;

    bRunning : BOOL;
    bSensorS1 : BOOL;
    bBottlePositioned : BOOL;
    bConveyorOn : BOOL;
    bEvOn : BOOL;
    bAtOn : BOOL;

    (* Intertravamento da valvula de envase (EV):
       S1 acusa a presenca da garrafa e a esteira esta parada. *)
    bEvInterlock : BOOL;

    nFillPercent : USINT;
    nBottlesFilled : UDINT;
    nBottlesCapped : UDINT;
    nProductionTotal : UDINT;
END_VAR
