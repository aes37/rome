import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { listSessions } from "@/lib/chat-api";
import { DEFAULT_PROJECT_NAME } from "@/lib/chat-constants";
import type { ChatSession } from "@/lib/chat-types";
import type { FileBrowserTreeNode } from "@/lib/file-browser-tree";
import { fetchJson } from "@/lib/fetch-json";
import { sessionActivityTime } from "@/lib/chat-session";
import { useSessionsChanged } from "@/lib/session-events";

/**
 * A project is a folder under the `projects` root, together with the chats
 * scoped to it. The folder is the project: its files are the project's
 * knowledge (the Files page), and a chat started in it works in that folder.
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

const PROJECTS_ROOT = "projects";
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

async function loadChatProjects(fallback: string): Promise<ChatProject[]> {
  const [nodes, sessions] = await Promise.all([
    fetchJson<FileBrowserTreeNode[]>(
      `/api/projects/tree?path=${encodeURIComponent(PROJECTS_ROOT)}&depth=1`,
      { fallback },
    ),
    listSessions("active"),
  ]);

  const byPath = new Map<string, ChatSession[]>();
  for (const node of nodes) {
    if (node.type !== "directory") continue;
    byPath.set(node.path.slice(PROJECTS_ROOT.length + 1), []);
  }
  // A chat can name a project whose folder the tree did not list (a folder
  // made outside the root's top level, or one being created), so the chats
  // add projects as well as fill them.
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
        name: projectNameFromPath(path),
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
  const { t } = useTranslation("common");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CHAT_PROJECTS_QUERY_KEY,
    queryFn: () => loadChatProjects(t("projectsPage.loadError")),
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

/** Creates the project's folder. Resolves to the new project's path. */
export async function createChatProject(name: string, fallback: string): Promise<string> {
  const result = await fetchJson<{ path?: string; error?: string }>("/api/projects/file", {
    method: "POST",
    json: { path: `${PROJECTS_ROOT}/${name}`, type: "folder" },
    fallback,
  });
  return (result.path ?? `${PROJECTS_ROOT}/${name}`).slice(PROJECTS_ROOT.length + 1);
}
