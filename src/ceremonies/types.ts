export interface Ceremony {
  readonly name: string;
  run(): Promise<void>;
}
