export interface Command {
  name: string;
  run(args: string[]): Promise<void>;
}
