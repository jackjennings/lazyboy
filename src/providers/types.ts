export interface WorkItem {
  id: string;
  provider: string;
  title: string;
  description: string;
  url: string;
}

export interface Provider {
  fetchNew(knownIds: Set<string>): Promise<WorkItem[]>;
}
