export interface Command {
  name: string;
  description?: string;
  usage?: string;
  completesWith?: "_ids" | string[];
  run(args: string[]): Promise<void>;
}
