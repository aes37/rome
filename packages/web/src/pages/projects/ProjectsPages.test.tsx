// @rstest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "@/i18n";
import type { ChatSession } from "@/lib/chat-types";
import { emitSessionsChanged } from "@/lib/session-events";
import ProjectDetailPage from "./ProjectDetailPage";
import ProjectsIndexPage from "./ProjectsIndexPage";

function chat(id: string, name: string, projectPath: string, activityAt: string): ChatSession {
  return {
    id,
    name,
    personaId: null,
    projectName: projectPath,
    projectPath,
    createdAt: activityAt,
    activityAt,
    lastSeenActivityAt: activityAt,
    unread: false,
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const record = (path: string) => ({
  name: path,
  displayName: path,
  projectPath: path,
  path: `/root/projects/${path}`,
});

let sessions: ChatSession[] = [];
let sessionsFail = false;
// Tree paths whose read fails, as a transient server error would.
const failingTrees = new Set<string>();
// While set, the projects root listing waits on it.
let rootGate: Promise<void> | null = null;
const createdProjects: string[] = [];
const fetchMock = rs.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/chat/sessions") {
    return sessionsFail ? new Response("down", { status: 500 }) : json(sessions);
  }
  if (url.pathname === "/api/chat/projects") {
    if (init?.method === "POST") {
      const { name } = JSON.parse(String(init.body)) as { name: string };
      createdProjects.push(name);
      return json(record(name));
    }
    // Core's records: the folders made outside them, such as `src`, are not projects.
    return json({
      rootPath: "/root/projects",
      defaultPath: "/root/projects/default",
      projects: [record("alpha"), record("empty")],
    });
  }
  if (url.pathname === "/api/projects/tree") {
    const path = url.searchParams.get("path") ?? "";
    if (failingTrees.has(path)) return new Response("down", { status: 500 });
    if (path === "projects") {
      if (rootGate) await rootGate;
      return json([
        { name: "alpha", path: "projects/alpha", type: "directory" },
        { name: "empty", path: "projects/empty", type: "directory" },
        // A folder with neither a record nor chats.
        { name: "loose", path: "projects/loose", type: "directory" },
        { name: "todo.md", path: "projects/todo.md", type: "file" },
      ]);
    }
    if (path === "projects/alpha") {
      return json([
        { name: "brief.md", path: "projects/alpha/brief.md", type: "file" },
        { name: "src", path: "projects/alpha/src", type: "directory" },
      ]);
    }
    return json([]);
  }
  return new Response("not found", { status: 404 });
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </output>
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects" element={<ProjectsIndexPage />} />
          <Route path="/projects/:projectPath" element={<ProjectDetailPage />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  rs.stubGlobal("fetch", fetchMock);
  sessionsFail = false;
  failingTrees.clear();
  rootGate = null;
  createdProjects.length = 0;
  sessions = [
    chat("a1", "Alpha older", "alpha", "2026-07-01T00:00:00.000Z"),
    chat("a2", "Alpha newest", "alpha", "2026-07-09T00:00:00.000Z"),
    // A chat whose project has no record still makes a project.
    chat("b1", "Beta only chat", "beta", "2026-07-05T00:00:00.000Z"),
  ];
});

afterEach(() => {
  cleanup();
  rs.unstubAllGlobals();
});

describe("Projects list", () => {
  it("shows every project record and chat project, most recently active first", async () => {
    renderAt("/projects");

    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/projects/alpha",
      "/projects/beta",
      "/projects/empty",
    ]);
    const alpha = links[0];
    expect(within(alpha).getByText("Alpha newest")).toBeTruthy();
    expect(within(alpha).getByText(/2 chats/)).toBeTruthy();
    expect(within(links[2]).getByText("No chats yet")).toBeTruthy();
    // A file at the root is not a project.
    expect(screen.queryByText("todo.md")).toBeNull();
  });

  it("creates a project through core's project records, which the composer's picker reads", async () => {
    const user = userEvent.setup();
    renderAt("/projects");

    await user.click(await screen.findByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "launch-plan");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await screen.findByText(/"pathname":"\/projects\/launch-plan"/);
    expect(createdProjects).toEqual(["launch-plan"]);
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input), "http://localhost").pathname === "/api/projects/file",
      ),
    ).toBe(false);
  });

  it("narrows the cards to the projects whose name matches the search", async () => {
    const user = userEvent.setup();
    renderAt("/projects");

    await screen.findByText("alpha");
    await user.type(screen.getByLabelText("Search projects"), "bet");

    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.queryByText("alpha")).toBeNull();
  });
});

describe("Project page", () => {
  it("lists the project's chats newest first beside its files", async () => {
    renderAt("/projects/alpha");

    const chats = await screen.findByRole("region", { name: "Chats" });
    const rows = await within(chats).findAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/chat/a2", "/chat/a1"]);
    expect(within(rows[0]).getByText("Alpha newest")).toBeTruthy();
    const files = screen.getByRole("region", { name: "Files" });
    expect(
      (await within(files).findByRole("link", { name: "brief.md" })).getAttribute("href"),
    ).toBe("/files/alpha/brief.md");
    expect(within(files).getByRole("link", { name: "Open in Files" }).getAttribute("href")).toBe(
      "/files/alpha",
    );
  });

  it("starts a new chat in the project's folder", async () => {
    const user = userEvent.setup();
    renderAt("/projects/alpha");

    await user.click(await screen.findByRole("button", { name: "New chat" }));

    expect(JSON.parse(screen.getByTestId("location").textContent ?? "{}")).toEqual({
      pathname: "/chat",
      state: { projectPath: "alpha" },
    });
  });

  it("opens an old link to a file at the projects root in Files", async () => {
    renderAt("/projects/todo.md?line=3");

    expect(await screen.findByText(/"pathname":"\/files\/todo.md"/)).toBeTruthy();
  });

  it("shows no project page while an old root-file link is being checked", async () => {
    let openGate = () => {};
    rootGate = new Promise((resolve) => {
      openGate = resolve;
    });
    renderAt("/projects/todo.md");

    // The project list has loaded and names no `todo.md`; the root check is pending.
    await rs.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            new URL(String(input), "http://localhost").searchParams.get("path") === "projects",
        ),
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.queryByText("todo.md")).toBeNull();

    openGate();
    expect(await screen.findByText(/"pathname":"\/files\/todo.md"/)).toBeTruthy();
  });

  it("keeps a folder's project page when its files fail to load", async () => {
    failingTrees.add("projects/loose");
    renderAt("/projects/loose");

    const files = await screen.findByRole("region", { name: "Files" });
    expect(await within(files).findByRole("alert")).toBeTruthy();
    expect(within(files).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/There's no project/)).toBeNull();
    expect(screen.getByText("No chats in this project yet")).toBeTruthy();
  });

  it("says a project is missing only when the projects root has no such folder", async () => {
    renderAt("/projects/nowhere");

    expect(await screen.findByText(/There's no project named “nowhere”/)).toBeTruthy();
  });

  it("offers a retry when the projects root cannot be read for an unknown project", async () => {
    failingTrees.add("projects");
    renderAt("/projects/loose");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/There's no project/)).toBeNull();
  });

  it("does not reload the files when the chats change", async () => {
    renderAt("/projects/alpha");
    await screen.findByRole("link", { name: "brief.md" });
    const calls = (pathname: string) =>
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input), "http://localhost").pathname === pathname,
      ).length;
    const sessionReads = calls("/api/chat/sessions");
    const treeReads = calls("/api/projects/tree");

    emitSessionsChanged();

    await rs.waitFor(() => expect(calls("/api/chat/sessions")).toBeGreaterThan(sessionReads));
    expect(calls("/api/projects/tree")).toBe(treeReads);
  });

  it("offers a retry when the project's chats cannot be loaded", async () => {
    sessionsFail = true;
    renderAt("/projects/alpha");

    const chats = await screen.findByRole("region", { name: "Chats" });
    expect(await within(chats).findByRole("alert")).toBeTruthy();
    expect(within(chats).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
