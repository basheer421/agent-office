// The office's prompts are written for GitHub (`gh pr view 12`, "pull request #12"). On a GitLab
// floor every prompt, defaults and ⚙️ rewrites alike, goes through this on its way to a worker
// (server/floor.ts for the ones the office sends, client/ui/prompts.ts for the boards' ones).

const SWAPS: [RegExp, string][] = [
  [/`?gh api repos\/\S+?\/pulls\/(\S+?)\/comments`?/g, '`glab api projects/:id/merge_requests/$1/discussions`'],
  [/\bgh pr checks (\S+) --watch\b/g, 'glab ci status --live (on its branch)'],
  [/\bgh pr checks\b/g, 'glab ci status'],
  [/\bgh pr view\b/g, 'glab mr view'],
  [/\bgh pr diff\b/g, 'glab mr diff'],
  [/\bgh pr checkout\b/g, 'glab mr checkout'],
  [/\bgh pr merge\b/g, 'glab mr merge'],
  [/\bgh pr create\b/g, 'glab mr create'],
  [/\bgh pr (comment|close|edit|list|review)\b/g, 'glab mr $1'],
  [/\bgh issue\b/g, 'glab issue'],
  [/\bthe gh CLI\b/g, 'the glab CLI'],
  [/\bpull requests\b/g, 'merge requests'],
  [/\bPull requests\b/g, 'Merge requests'],
  [/\bpull request #/g, 'merge request !'],
  [/\bpull request\b/g, 'merge request'],
  [/\bPull request\b/g, 'Merge request'],
  [/\bPRs\b/g, 'MRs'],
  [/\bPR #/g, 'MR !'],
  [/\bPR\b/g, 'MR'],
  [/\b([Aa]) MR\b/g, '$1n MR'],
];

/** A GitHub-worded prompt in GitLab words and `glab` commands. */
export function glabPrompt(text: string): string {
  return SWAPS.reduce((t, [re, to]) => t.replace(re, to), text);
}
