import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { createProject, listProjects, listSessions } from "@/lib/chat-api";
import { DEFAULT_PROJECT_NAME } from "@/lib/chat-constants";
import type { ChatSession, ProjectOption } from "@/lib/chat-types";
import { sessionActivityTime } from "@/lib/chat-session";
import { useSessionsChanged } from "@/lib/session-events";

/**
 * A project is one of core's project records, the list the composer's project
 * picker offers, together with the chats scoped to it. Each record owns a
 * folder under the `projects` root: its files are the project's knowledge (the
 * Files page), and a chat started in it works in that folder.
 */
export interface ChatProject {
  /** Relative to the projects root, as chats carry it: `website-redesign`. */
  path: string;
  name: string;
  /** Newest activity first. */
  chats: ChatSession[];
  /** The newest chat's activity, or null for a project with no chats. */
  activityAt: string | null;
}

const CHAT_PROJECTS_QUERY_KEY = ["chat-projects"] as const;

export function projectNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** The project a chat belongs to. A chat with no folder runs in `default`. */
export function projectPathForChat(chat: {
  projectPath?: string | null;
  projectName?: string | null;
}): string {
  return chat.projectPath || chat.projectName || DEFAULT_PROJECT_NAME;
}

export function filesHrefForProject(path: string): string {
  return `/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function projectHref(path: string): string {
  return `/projects/${encodeURIComponent(path)}`;
}

/** A record's path relative to the projects root, as chats carry it. */
function recordPath(project: ProjectOption): string {
  return project.projectPath || project.name;
}

async function loadChatProjects(): Promise<ChatProject[]> {
  const [catalog, sessions] = await Promise.all([listProjects(), listSessions("active")]);

  const byPath = new Map<string, ChatSession[]>();
  const names = new Map<string, string>();
  for (const project of catalog.projects) {
    const path = recordPath(project);
    byPath.set(path, []);
    if (project.displayName) names.set(path, project.displayName);
  }
  // A chat can name a project with no record (one from before records, or
  // one being created), so the chats add projects as well as fill them.
  for (const session of sessions) {
    const path = projectPathForChat(session);
    const chats = byPath.get(path) ?? [];
    chats.push(session);
    byPath.set(path, chats);
  }

  return [...byPath.entries()]
    .map(([path, chats]) => {
      chats.sort((a, b) => sessionActivityTime(b) - sessionActivityTime(a));
      return {
        path,
        name: names.get(path) ?? projectNameFromPath(path),
        chats,
        activityAt: chats[0]?.activityAt ?? null,
      };
    })
    .sort((a, b) => {
      const byActivity =
        (b.chats[0] ? sessionActivityTime(b.chats[0]) : 0) -
        (a.chats[0] ? sessionActivityTime(a.chats[0]) : 0);
      return byActivity || a.name.localeCompare(b.name);
    });
}

export function useChatProjects() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CHAT_PROJECTS_QUERY_KEY,
    queryFn: loadChatProjects,
  });
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: CHAT_PROJECTS_QUERY_KEY }),
    [queryClient],
  );
  useSessionsChanged(() => {
    void invalidate();
  });
  return {
    projects: query.data ?? null,
    error: query.error,
    refetch: query.refetch,
    invalidate,
  };
}

/** Creates the project's record and folder through core, the same path the
 *  composer's picker uses. Resolves to the new project's path. */
export async function createChatProject(name: string): Promise<string> {
  return recordPath(await createProject(name));
}
