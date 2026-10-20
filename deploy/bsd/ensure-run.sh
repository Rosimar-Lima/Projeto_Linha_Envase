#!/bin/sh
#
# Garante que o TwinCAT Runtime esteja em RUN apos o boot da VM.
#
# Contexto: em alguns boots a criacao do objeto do PLC estoura timeout
# (ADS 0x745) e o TwinCAT sobe em CONFIG. Com o runtime em CONFIG o app
# reporta "offline" e a IHM fica presa. Este script:
#   1) espera o TwinCAT responder;
#   2) se nao estiver em RUN, solicita "--run";
#   3) se ainda assim nao subir, reinicia o TcSystemService.
#
# Chamado em segundo plano pelo servico rc.d linha_envase_runwatch.
# Log: /var/log/linha-envase-ensure-run.log

set -u

# Sob o daemon(8) o PATH nao inclui /usr/local/*; sem isso o TcSysExe.exe nao
# encontra o TcSystemService (erro "not found") e --mode falha.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

TCSYS=/usr/local/bin/TcSysExe.exe
LOG=/var/log/linha-envase-ensure-run.log

# Evita que um TcSysExe.exe pendurado trave o helper (e o boot). Se nao houver
# /usr/bin/timeout, segue sem limite.
TIMEOUT=/usr/bin/timeout
[ -x "$TIMEOUT" ] || TIMEOUT=""

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

run_t() {
    _secs=$1
    shift
    if [ -n "$TIMEOUT" ]; then
        "$TIMEOUT" "$_secs" "$@"
    else
        "$@"
    fi
}

is_run() { run_t 15 "$TCSYS" --mode 2>/dev/null | grep -q 'RUN'; }

log "ensure-run: iniciando verificacao do modo do TwinCAT."

i=0
while [ "$i" -lt 10 ]; do
    if is_run; then
        log "ensure-run: TwinCAT ja em RUN (apos ${i}s)."
        exit 0
    fi
    sleep 1
    i=$((i + 1))
done

log "ensure-run: TwinCAT nao esta em RUN; solicitando --run."
run_t 25 "$TCSYS" --run >>"$LOG" 2>&1 || true

i=0
while [ "$i" -lt 30 ]; do
    if is_run; then
        log "ensure-run: TwinCAT em RUN apos --run (${i}s)."
        exit 0
    fi
    sleep 1
    i=$((i + 1))
done

log "ensure-run: ainda fora de RUN; reiniciando TcSystemService."
run_t 90 service TcSystemService restart >>"$LOG" 2>&1 || true

i=0
while [ "$i" -lt 60 ]; do
    sleep 1
    if is_run; then
        log "ensure-run: TwinCAT em RUN apos reiniciar o servico (${i}s)."
        exit 0
    fi
    i=$((i + 1))
done

log "ensure-run: FALHA - TwinCAT permaneceu fora de RUN."
exit 1
