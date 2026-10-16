// @rstest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "@/i18n";
import type { ChatSession } from "@/lib/chat-types";
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
    const path = url.searchParams.get("path");
    if (path === "projects") {
      return json([
        { name: "alpha", path: "projects/alpha", type: "directory" },
        { name: "empty", path: "projects/empty", type: "directory" },
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

  it("offers a retry when the project's chats cannot be loaded", async () => {
    sessionsFail = true;
    renderAt("/projects/alpha");

    const chats = await screen.findByRole("region", { name: "Chats" });
    expect(await within(chats).findByRole("alert")).toBeTruthy();
    expect(within(chats).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
