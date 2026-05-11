#!/bin/sh
set -e
# 镜像默认以 nextjs(1001) 运行；绑定挂载的 config 常为宿主机属主，会导致 EACCES。
# 启动前尝试修正 CONFIG_PATH 指向的文件（失败则忽略，例如只读卷）。
CONFIG_FILE="${CONFIG_PATH:-/config/config.json}"
if [ -f "$CONFIG_FILE" ]; then
  chown nextjs:nodejs "$CONFIG_FILE" 2>/dev/null || true
  chmod u+rw,g+rw "$CONFIG_FILE" 2>/dev/null || true
  if ! su-exec nextjs:nodejs test -w "$CONFIG_FILE"; then
    chmod a+rw "$CONFIG_FILE" 2>/dev/null || true
  fi
fi
exec su-exec nextjs:nodejs "$@"
