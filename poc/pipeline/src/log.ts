import chalk from 'chalk';

const ts = () => new Date().toISOString().slice(11, 23);

function fmtValue(v: unknown): string {
  if (typeof v === 'string') return chalk.white(`"${v}"`);
  if (typeof v === 'number') return chalk.yellow(String(v));
  if (typeof v === 'boolean') return chalk.magenta(String(v));
  if (Array.isArray(v)) return chalk.cyan(`[${v.map((x) => (typeof x === 'string' ? `"${x}"` : String(x))).join(', ')}]`);
  if (v && typeof v === 'object') return chalk.dim(JSON.stringify(v));
  return chalk.dim(String(v));
}

export const log = {
  info: (msg: string) => console.log(chalk.gray(`[${ts()}] `) + msg),
  success: (msg: string) => console.log(chalk.gray(`[${ts()}] `) + chalk.green(msg)),
  warn: (msg: string) => console.log(chalk.gray(`[${ts()}] `) + chalk.yellow(msg)),
  error: (msg: string) => console.log(chalk.gray(`[${ts()}] `) + chalk.red(msg)),

  hook: (event: string, payload: Record<string, unknown>) => {
    console.log(chalk.gray(`[${ts()}] `) + chalk.cyanBright(`◆ ${event}`));
    for (const [k, v] of Object.entries(payload)) {
      console.log(chalk.gray(`            ${k.padEnd(14)}`) + ' ' + fmtValue(v));
    }
  },

  tick: (n: number, ctx: Record<string, unknown>) => {
    const header = chalk.magentaBright(`▶ tick #${String(n).padStart(3, '0')}`);
    console.log(chalk.gray(`[${ts()}] `) + header);
    for (const [k, v] of Object.entries(ctx)) {
      if (k === 'stream_key' || k === 'ts') continue;
      console.log(chalk.gray(`            ${k.padEnd(22)}`) + ' ' + fmtValue(v));
    }
  },

  banner: (title: string, subtitle?: string) => {
    const line = '─'.repeat(64);
    console.log();
    console.log(chalk.cyan(line));
    console.log(chalk.cyan('▌ ') + chalk.bold.cyan(title));
    if (subtitle) console.log(chalk.cyan('▌ ') + chalk.dim(subtitle));
    console.log(chalk.cyan(line));
    console.log();
  },
};
