export interface ProjectDecision {
  id: string;
  title: string;
  reason?: string;
  date: string;
  updatedBy?: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
  updatedBy?: string;
}

export interface ImportantFileRef {
  path: string;
  purpose?: string;
  importance?: string;
}

export interface ContextHistoryEntry {
  timestamp: string;
  updatedBy?: string;
  field: string;
  summary: string;
}

export interface ProjectContext {
  projectId: string;
  workspaceRoots: string[];
  projectSummary?: string;
  currentObjective?: string;
  activeTask?: string;
  taskStatus?: "pending" | "in_progress" | "done";
  decisions: ProjectDecision[];
  importantFiles: ImportantFileRef[];
  knownIssues: string[];
  todos: string[];
  architectureNotes?: string;
  conventions?: string;
  lastUpdated: string;
  updatedBy?: string;
  history: ContextHistoryEntry[];
}

export function emptyProjectContext(projectId: string, workspaceRoots: string[]): ProjectContext {
  const now = new Date().toISOString();
  return {
    projectId,
    workspaceRoots,
    decisions: [],
    importantFiles: [],
    knownIssues: [],
    todos: [],
    lastUpdated: now,
    history: [],
  };
}
