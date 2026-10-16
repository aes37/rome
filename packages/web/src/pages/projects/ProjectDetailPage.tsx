import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, File, Folder, FolderKanban, MessageSquare } from "lucide-react";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  EmptyStateAction,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
} from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { filesHrefForProject, useChatProjects } from "@/hooks/use-chat-projects";
import type { FileBrowserTreeNode } from "@/lib/file-browser-tree";
import { fetchJson } from "@/lib/fetch-json";
import { relativeTime } from "@/lib/routine-language";
import {
  Page,
  PageActions,
  PageHeader,
  PageHeaderNav,
  PageHeading,
  PageTitle,
  Section,
  SectionHeader,
  SectionHeading,
  SectionTitle,
} from "@rome-os/ui/page";

const ROW_CLASS =
  "flex min-h-[var(--control-min-h)] items-center gap-3 rounded-8 border border-transparent px-3 py-2 text-ui text-foreground outline-none outline-1 outline-offset-0 outline-transparent transition hover:bg-surface-hover focus-visible:outline-solid focus-visible:outline-ring/50 dark:hover:bg-surface";
// Chat rows are the page's main list, so they get more room than the file rows.
const CHAT_ROW_CLASS =
  "flex min-h-[var(--control-min-h)] items-center gap-3 rounded-8 border border-transparent px-4 py-3 text-ui text-foreground outline-none outline-1 outline-offset-0 outline-transparent transition hover:bg-surface-hover focus-visible:outline-solid focus-visible:outline-ring/50 dark:hover:bg-surface";

function useProjectFiles(path: string) {
  const { t } = useTranslation("common");
  return useQuery({
    queryKey: ["chat-projects", "files", path],
    queryFn: () =>
      fetchJson<FileBrowserTreeNode[]>(
        `/api/projects/tree?path=${encodeURIComponent(`projects/${path}`)}&depth=1`,
        { fallback: t("projectsPage.filesLoadError") },
      ),
  });
}

// The top level of the projects root, read only when the URL names no known
// project: the Files page used to live at /projects, so an old link can name a
// file there.
function useProjectsRootEntries(enabled: boolean) {
  const { t } = useTranslation("common");
  return useQuery({
    queryKey: ["chat-projects", "root-entries"],
    enabled,
    queryFn: () =>
      fetchJson<FileBrowserTreeNode[]>("/api/projects/tree?path=projects&depth=1", {
        fallback: t("projectsPage.filesLoadError"),
      }),
  });
}

// One project: its chats, newest first, with a way to start another in its
// folder, beside the folder's top-level files.
export default function ProjectDetailPage() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();
  const { projectPath = "" } = useParams<{ projectPath: string }>();
  const { projects, error, refetch } = useChatProjects();
  const files = useProjectFiles(projectPath);
  const project = projects?.find((candidate) => candidate.path === projectPath) ?? null;
  const unknownProject = projects !== null && project === null;
  const rootEntries = useProjectsRootEntries(unknownProject);
  const name = project?.name ?? projectPath;
  useDocumentTitle(name);

  const startChat = () => navigate("/chat", { state: { projectPath } });

  const isRootFile = rootEntries.data?.some(
    (entry) => entry.type === "file" && entry.path === `projects/${projectPath}`,
  );
  if (isRootFile) {
    return (
      <Navigate
        to={`${filesHrefForProject(projectPath)}${location.search}${location.hash}`}
        replace
      />
    );
  }
  // Wait for the root check before calling the project missing.
  if (unknownProject && files.isError && rootEntries.isPending) return null;

  if (unknownProject && files.isError) {
    return (
      <Page>
        <EmptyState role="status">
          <EmptyStateIcon>
            <FolderKanban className="h-5 w-5" aria-hidden />
          </EmptyStateIcon>
          <EmptyStateTitle>{t("projectsPage.notFound", { name: projectPath })}</EmptyStateTitle>
          <EmptyStateAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/projects">{t("projectsPage.allProjects")}</Link>
            </Button>
          </EmptyStateAction>
        </EmptyState>
      </Page>
    );
  }

  // A folder with no record and no chats yet is an empty project.
  const chats = projects === null ? null : (project?.chats ?? []);

  return (
    <Page>
      <PageHeader>
        <PageHeaderNav>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 rounded-4 text-aux text-subtle-foreground outline-none outline-1 outline-offset-0 outline-transparent transition hover:text-foreground focus-visible:outline-solid focus-visible:outline-ring/50"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t("projectsPage.allProjects")}
          </Link>
        </PageHeaderNav>
        <PageHeading>
          <PageTitle>{name}</PageTitle>
        </PageHeading>
        <PageActions>
          <Button type="button" size="sm" onClick={startChat}>
            <Pencil2Icon data-icon="inline-start" className="h-3.5 w-3.5" aria-hidden />
            {t("projectsPage.newChat")}
          </Button>
        </PageActions>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Section aria-labelledby="project-chats-heading">
          <SectionHeader>
            <SectionHeading>
              <SectionTitle id="project-chats-heading">{t("projectsPage.chats")}</SectionTitle>
            </SectionHeading>
          </SectionHeader>
          {error && projects === null ? (
            <EmptyState role="alert">
              <EmptyStateTitle>{t("projectsPage.loadError")}</EmptyStateTitle>
              <EmptyStateAction>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                  {t("projectsPage.retry")}
                </Button>
              </EmptyStateAction>
            </EmptyState>
          ) : chats === null ? (
            <div className="flex flex-col gap-1" aria-busy>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/5" />
              <Skeleton className="h-10 w-3/5" />
            </div>
          ) : chats.length === 0 ? (
            <EmptyState role="status">
              <EmptyStateIcon>
                <MessageSquare className="h-5 w-5" aria-hidden />
              </EmptyStateIcon>
              <EmptyStateTitle>{t("projectsPage.noChats")}</EmptyStateTitle>
              <EmptyStateDescription>{t("projectsPage.noChatsHint")}</EmptyStateDescription>
              <EmptyStateAction>
                <Button type="button" variant="outline" size="sm" onClick={startChat}>
                  {t("projectsPage.newChat")}
                </Button>
              </EmptyStateAction>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link to={`/chat/${encodeURIComponent(chat.id)}`} className={CHAT_ROW_CLASS}>
                    <span className="min-w-0 flex-1 truncate">{chat.name}</span>
                    <span className="shrink-0 text-aux text-subtle-foreground">
                      {relativeTime(chat.activityAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section aria-labelledby="project-files-heading">
          <SectionHeader>
            <SectionHeading>
              <SectionTitle id="project-files-heading">{t("projectsPage.files")}</SectionTitle>
            </SectionHeading>
          </SectionHeader>
          <div className="flex flex-col gap-1 rounded-12 border border-border p-2">
            {files.isPending ? (
              <>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </>
            ) : files.isError || files.data.length === 0 ? (
              <p className="px-3 py-2 text-aux text-subtle-foreground">
                {files.isError ? t("projectsPage.filesLoadError") : t("projectsPage.noFiles")}
              </p>
            ) : (
              files.data.map((node) => {
                const relative = node.path.slice("projects/".length);
                return (
                  <Link key={node.path} to={filesHrefForProject(relative)} className={ROW_CLASS}>
                    {node.type === "directory" ? (
                      <Folder className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  </Link>
                );
              })
            )}
            <Link
              to={filesHrefForProject(projectPath)}
              className={`${ROW_CLASS} text-aux text-subtle-foreground hover:text-foreground`}
            >
              {t("projectsPage.openFiles")}
            </Link>
          </div>
        </Section>
      </div>
    </Page>
  );
}
