// Projects as folders on the office's machine: browsing for one to open as a floor, and the project
// settings each floor has (what's detected, and what someone overrode).
import type { HostKind } from '../model/host.js';

/** What someone may override in ⚙️ Project settings; everything else is detected. */
export interface ProjectOverrides {
  pushRemote?: string;
  baseBranch?: string;
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
}

export interface ProjectRootsState {
  /** Folders 📂 Open folder may open projects from, as typed (~ for home). */
  roots: string[];
  /** Hostnames whose remotes are GitLab. */
  gitlabHosts: string[];
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
  | { t: 'project.roots'; state?: Partial<ProjectRootsState> };

export type ProjectServerMsg =
  | { t: 'project.listing'; path: string; parent?: string; roots: string[]; entries: FolderEntry[]; git?: boolean; error?: string }
  | { t: 'project.opened'; dir: string; floor?: string; error?: string }
  | { t: 'project.config'; floor: string; config?: ProjectConfig; error?: string }
  | { t: 'project.roots'; state: ProjectRootsState };
