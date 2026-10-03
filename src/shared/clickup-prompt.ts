// The office's issue prompts are written for GitHub issues (`gh issue view 12`, "closes #12"). On a
// floor whose issues are a ClickUp space, the boards use these instead: the task's id and link go in
// the prompt and the change request's description, and nothing is written back to ClickUp (the
// office's ClickUp is read-only; status and comments stay with people).

export interface ClickUpTaskVars {
  /** How people write it: its custom id, else its id. */
  ref: string;
  title: string;
  url: string;
}

const READ = (v: ClickUpTaskVars) => `Read it first at ${v.url} (or with the ClickUp MCP tools if you have them).`;

export const clickupPrompts = {
  work: (v: ClickUpTaskVars) =>
    `Work on ClickUp task ${v.ref}: "${v.title}" (${v.url}).\n\n${READ(v)} Create a new branch, implement the change, verify it, then open a pull request whose description names the task: "ClickUp task ${v.ref}: ${v.url}". Don't change the task in ClickUp (status, assignees, comments): people do that.`,
  ask: (v: ClickUpTaskVars) => `This is about ClickUp task ${v.ref} "${v.title}" (${v.url}). ${READ(v)}`,
  meeting: (v: ClickUpTaskVars) => `ClickUp task ${v.ref}: “${v.title}” (${v.url}). ${READ(v)}`,
};
