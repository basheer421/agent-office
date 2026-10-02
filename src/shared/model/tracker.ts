// What an issue tracker (GitHub issues, ClickUp, none) can do.

export type TrackerKind = 'github' | 'clickup' | 'none';

export interface TrackerCapabilities {
  comment: boolean;
  close: boolean;
  assign: boolean;
  labels: boolean;
}
