#!/bin/sh
#
# Bootstrap do servico linha_envase no TwinCAT/BSD.
#
# Faz tudo na VM, a partir de onde o projeto estiver copiado:
#   1) instala o Node.js (pkg install node) se ainda nao houver;
#   2) copia o projeto para APP_DIR (sem node_modules/.git/logs/.env);
#   3) executa deploy/bsd/install.sh (deps, .env, servico, start).
#
# Uso (na VM):
#   doas sh /caminho/Projeto_Linha_Envase/deploy/bsd/bootstrap.sh
#
# Variaveis (opcionais):
#   APP_DIR   destino do projeto  (default /opt/linha-envase)
#   RUN_USER  usuario do servico  (default root)

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
APP_DIR=${APP_DIR:-/opt/linha-envase}
RUN_USER=${RUN_USER:-root}

log() { printf '%s\n' "$*"; }
die() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    die "Rode como root (doas sh bootstrap.sh)."
fi

[ -f "${SOURCE_DIR}/server.js" ] || die "server.js nao encontrado em ${SOURCE_DIR}."

# 1) Node.js
if command -v node >/dev/null 2>&1 || [ -x /usr/local/bin/node ]; then
    log "Node.js ja instalado: $(command -v node 2>/dev/null || echo /usr/local/bin/node)"
else
    log "Instalando Node.js (pkg install node)..."
    if ! pkg install -y node; then
        die "Falha ao instalar o Node. A VM tem internet? Adicione um adaptador NAT
     no VirtualBox (Configuracoes -> Rede -> Adaptador 2 -> NAT), suba a VM e
     rode este bootstrap novamente."
    fi
fi

NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "${NODE_BIN}" ] && [ -x /usr/local/bin/node ]; then
    NODE_BIN=/usr/local/bin/node
fi
[ -n "${NODE_BIN}" ] || die "node nao encontrado apos a instalacao."
log "Node: ${NODE_BIN} ($("${NODE_BIN}" -v))"

# 2) Copia do projeto para APP_DIR
if [ "${SOURCE_DIR}" = "${APP_DIR}" ]; then
    log "Projeto ja esta em ${APP_DIR}; copia ignorada."
else
    log "Copiando ${SOURCE_DIR} -> ${APP_DIR} (sem node_modules/.git/logs/.env)..."
    mkdir -p "${APP_DIR}"
    ( cd "${SOURCE_DIR}" && tar cf - \
        --exclude node_modules --exclude .git --exclude logs --exclude .env . ) \
        | ( cd "${APP_DIR}" && tar xf - )
fi

# 3) install.sh
log "Executando install.sh..."
( cd "${APP_DIR}/deploy/bsd" && APP_DIR="${APP_DIR}" RUN_USER="${RUN_USER}" sh install.sh )

# 4) firewall: libera a porta ADS 48898 (desabilitada por padrao no pf do TC/BSD)
log ""
log "Ajustando o firewall para o ADS simples (48898)..."
( cd "${APP_DIR}/deploy/bsd" && sh fix-ads.sh )

log ""
log "Bootstrap concluido."
log "  Status : doas service linha_envase status"
log "  Log    : tail -f /var/log/linha_envase.log"
log "  IHM    : http://<ip-da-vm>:3000"
log "Revise o ADS_TARGET_AMS_NET_ID em ${APP_DIR}/.env se necessario."
