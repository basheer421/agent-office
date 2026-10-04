// Projects as folders on the office's machine: browsing for one to open as a floor, and the project
// settings each floor has (what's detected, and what someone overrode).
import type { HostKind } from '../model/host.js';

/** What someone may override in ⚙️ Project settings; everything else is detected. */
export interface ProjectOverrides {
  pushRemote?: string;
  baseBranch?: string;
  /** The ClickUp space whose open tasks are the floor's issues (its id); none keeps the host's issues. */
  clickupSpace?: string;
  /** The list in that space new tasks go in (its id); none means the space's first list. */
  clickupList?: string;
}

/** A ClickUp space ⚙️ Project settings can pick. */
export interface ClickUpSpaceChoice {
  id: string;
  name: string;
}

export interface DetectedProject {
  isGit: boolean;
  remotes: string[];
  pushRemote?: string;
  url?: string;
  host: HostKind;
  hostname?: string;
  projectPath?: string;
  baseBranch?: string;
}

/** Detected ⊕ overrides. */
export interface ProjectConfig extends DetectedProject {
  detected: DetectedProject;
  overridden: (keyof ProjectOverrides)[];
  clickupSpace?: string;
  clickupList?: string;
  /** The spaces the office's ClickUp token sees, for picking one, or why there are none; and the picked space's lists. */
  clickup?: { spaces: ClickUpSpaceChoice[]; error?: string; lists?: ClickUpSpaceChoice[]; listsError?: string };
}

export interface ProjectRootsState {
  /** Folders 📂 Open folder may open projects from, as typed (~ for home). */
  roots: string[];
  /** Hostnames whose remotes are GitLab. */
  gitlabHosts: string[];
  /** Where ⬇️ Clone lists projects from: GitHub through gh, or the first GitLab host through glab. */
  defaultHost: 'github' | 'gitlab';
}

/** A GitLab project the office's glab sign-in is a member of, for ⬇️ Clone. */
export interface GitLabRepoChoice {
  /** group/…/name */
  path: string;
  description?: string;
  /** ISO time of the last activity. */
  activityAt?: string;
  /** Already a floor. */
  floor?: string;
}

export interface FolderEntry {
  name: string;
  /** A git checkout. */
  git: boolean;
  /** Already a floor. */
  floor?: string;
}

export type ProjectClientMsg =
  | { t: 'project.browse'; path?: string }
  | { t: 'project.open'; dir: string }
  | { t: 'project.config'; floor: string }
  | { t: 'project.configure'; floor: string; overrides: ProjectOverrides }
  | { t: 'project.roots'; state?: Partial<ProjectRootsState> }
  | { t: 'project.gitlabRepos'; refresh?: boolean }
  | { t: 'project.clone'; path: string };

export type ProjectServerMsg =
  | { t: 'project.listing'; path: string; parent?: string; roots: string[]; entries: FolderEntry[]; git?: boolean; error?: string }
  | { t: 'project.opened'; dir: string; floor?: string; error?: string }
  | { t: 'project.config'; floor: string; config?: ProjectConfig; error?: string }
  | { t: 'project.roots'; state: ProjectRootsState }
  | { t: 'project.gitlabRepos'; host: string; repos: GitLabRepoChoice[]; error?: string };
