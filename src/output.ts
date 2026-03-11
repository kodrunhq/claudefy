import chalk from "chalk";

export const output = {
  success: (msg: string) => console.log(chalk.green("\u2714") + " " + msg),
  info: (msg: string) => console.log(chalk.blue("\u2139") + " " + msg),
  warn: (msg: string) => console.error(chalk.yellow("\u26A0") + " " + msg),
  error: (msg: string) => console.error(chalk.red("\u2716") + " " + msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  heading: (msg: string) => console.log(chalk.bold.underline(msg)),
};
