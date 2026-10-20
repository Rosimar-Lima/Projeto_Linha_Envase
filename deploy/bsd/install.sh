#!/bin/sh
#
# Instala e habilita o servico linha_envase no TwinCAT/BSD (FreeBSD-like).
# Execute como root, de dentro da pasta deploy/bsd (no TC/BSD use doas):
#   doas sh install.sh
#
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=${APP_DIR:-/opt/linha-envase}
SERVICE=/usr/local/etc/rc.d/linha_envase
RUN_USER=${RUN_USER:-root}

if [ "$(id -u)" -ne 0 ]; then
    echo "Rode como root (doas sh install.sh)." >&2
    exit 1
fi

NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "${NODE_BIN}" ] && [ -x /usr/local/bin/node ]; then
    NODE_BIN=/usr/local/bin/node
fi
if [ -z "${NODE_BIN}" ]; then
    echo "Node.js nao encontrado. Instale com: doas pkg install node" >&2
    exit 1
fi

NPM_BIN=$(command -v npm 2>/dev/null || true)
if [ -z "${NPM_BIN}" ] && [ -x /usr/local/bin/npm ]; then
    NPM_BIN=/usr/local/bin/npm
fi
if [ -z "${NPM_BIN}" ]; then
    echo "npm nao encontrado (deveria vir com o pacote node)." >&2
    exit 1
fi

if [ ! -f "${APP_DIR}/server.js" ]; then
    echo "server.js nao encontrado em ${APP_DIR}." >&2
    echo "Copie o projeto para ${APP_DIR} (ex.: cp -R /caminho/Projeto_Linha_Envase ${APP_DIR})." >&2
    exit 1
fi

if [ ! -d "${APP_DIR}/node_modules" ]; then
    echo "Instalando dependencias em ${APP_DIR}..."
    (cd "${APP_DIR}" && "${NPM_BIN}" install --omit=dev)
fi

if [ ! -f "${APP_DIR}/.env" ]; then
    echo "Criando .env a partir de env.example (revise HOST e ADS_TARGET_AMS_NET_ID)..."
    cp "${SCRIPT_DIR}/env.example" "${APP_DIR}/.env"
elif grep -q '^HOST=127\.0\.0\.1' "${APP_DIR}/.env" 2>/dev/null; then
    echo "AVISO: .env usa HOST=127.0.0.1; a IHM nao sera acessivel de fora da VM." >&2
    echo "       Ajuste para HOST=0.0.0.0 para abrir pelo navegador do host." >&2
fi

install -m 0755 "${SCRIPT_DIR}/linha_envase" "${SERVICE}"

sysrc linha_envase_enable="YES"
sysrc linha_envase_dir="${APP_DIR}"
sysrc linha_envase_node="${NODE_BIN}"
sysrc linha_envase_user="${RUN_USER}"

# Recuperacao de RUN no boot: se o TwinCAT subir em CONFIG (timeout de boot),
# um script em segundo plano pede --run e, se preciso, reinicia o TcSystemService.
install -m 0755 "${SCRIPT_DIR}/ensure-run.sh" /usr/local/libexec/linha-envase-ensure-run.sh
install -m 0755 "${SCRIPT_DIR}/linha_envase_runwatch" /usr/local/etc/rc.d/linha_envase_runwatch
sysrc linha_envase_runwatch_enable="YES"

service linha_envase restart

echo "Servico linha_envase habilitado e iniciado."
echo "Status: service linha_envase status"
echo "Log   : tail -f /var/log/linha_envase.log"
echo "RUN no boot: service linha_envase_runwatch status (log /var/log/linha-envase-ensure-run.log)"
