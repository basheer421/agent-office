// A label on a change request or an issue, whichever host or tracker it came from.

/** `color` is a CSS color ("#d73a4a"). */
export interface Label {
  name: string;
  color: string;
  description?: string;
}
