export interface Command {
  name: string;
  description?: string;
  completesWith?: "_ids" | string[];
  run(args: string[]): Promise<void>;
}
