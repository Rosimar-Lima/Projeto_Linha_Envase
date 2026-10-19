#!/bin/sh
#
# Corrige a comunicacao ADS local (porta 48898) no TwinCAT/BSD.
#
# O firewall pf do TC/BSD vem com o ADS simples (48898) desabilitado por padrao;
# o ads-client usa essa porta. Este script:
#   - mostra o modo do runtime TwinCAT e quem escuta em 48898/8016;
#   - libera a porta 48898 no /etc/pf.conf (idempotente, com backup);
#   - testa a conexao local e reinicia o servico da IHM.
#
# Uso (na VM):
#   doas sh fix-ads.sh

set -u

RULE='pass in quick proto tcp to port 48898 synproxy state'
PF_CONF=/etc/pf.conf

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (doas sh fix-ads.sh)." >&2; exit 1; }

echo "== Runtime TwinCAT =="
if command -v TcSysExe.exe >/dev/null 2>&1; then
    TcSysExe.exe --mode 2>/dev/null || echo "(nao foi possivel ler o modo)"
else
    echo "TcSysExe.exe nao encontrado no PATH."
fi

echo
echo "== Listeners ADS (48898 / 8016) =="
sockstat -4l 2>/dev/null | grep -E '48898|8016' || echo "(nada escutando em 48898/8016)"

echo
echo "== Firewall pf =="
if pfctl -s info 2>/dev/null | grep -qi "Status: Disabled"; then
    echo "pf esta DESABILITADO; nada a liberar."
else
    if pfctl -sr 2>/dev/null | grep -q 48898; then
        echo "Ja existe regra para a porta 48898."
    else
        cp "$PF_CONF" "${PF_CONF}.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
        printf '\n# ADS simples (48898) - IHM Linha de Envase\n%s\n' "$RULE" >> "$PF_CONF"
        echo "Regra adicionada em ${PF_CONF} (backup .bak criado)."
    fi
    pfctl -f "$PF_CONF" && echo "pf recarregado."
fi

echo
echo "== Teste de conexao local a 127.0.0.1:48898 =="
if nc -z -w 2 127.0.0.1 48898 2>/dev/null; then
    echo "OK: a porta 48898 aceita conexao local."
else
    echo "FALHA: 127.0.0.1:48898 nao responde. Confirme que o runtime esta em Run"
    echo "       (doas TcSysExe.exe --run) e que o roteador ADS subiu."
fi

echo
echo "== Reiniciando a IHM =="
service linha_envase restart 2>/dev/null || service linha_envase start 2>/dev/null || true
echo "Aguarde ~5s e confira: tail -f /var/log/linha_envase.log"
