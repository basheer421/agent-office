// The GitHub windows behind the board cards (a PR, an issue, the label picker) live in github/; this
// is where the rest of the client finds them.
export { routePullMessage } from './boards/api';
export { openIssue } from './boards/issue-window';
export { labelChip, openLabels } from './boards/labels';
export { openPull } from './boards/pull-window';
