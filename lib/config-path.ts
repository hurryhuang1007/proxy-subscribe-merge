import path from 'node:path';

export function getConfigPath(): string {
  return path.resolve(process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config.json'));
}
