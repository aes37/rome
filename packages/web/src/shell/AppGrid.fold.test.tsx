// @rstest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import i18n from "@/i18n";
import { AppGrid } from "./AppGrid";

const fetchMock = rs.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (url === "/api/apps") return json({ apps: [] });
  if (url === "/api/apps/updates") return json({ upgradable: [] });
  if (url === "/api/settings") return json({});
  return new Response(null, { status: 404 });
});

function GoTo({ path }: { path: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(path)}>
      Go to {path}
    </button>
  );
}

function renderSidebar(initialEntry: string, { collapsed = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppGrid collapsed={collapsed} />
        <GoTo path="/people" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  fetchMock.mockClear();
  rs.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  rs.unstubAllGlobals();
  localStorage.clear();
});

describe("sidebar fold", () => {
  it("reaches the Browser from the fold", async () => {
    renderSidebar("/chat");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));

    const fold = screen.getByRole("navigation", { name: "More" });
    expect(within(fold).getByRole("link", { name: "Browser" }).getAttribute("href")).toBe(
      "/desktop",
    );
  });

  it("reopens when the guardian moves to another of its pages", async () => {
    renderSidebar("/memory");
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByRole("navigation", { name: "More" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Go to /people" }));

    const fold = screen.getByRole("navigation", { name: "More" });
    expect(within(fold).getByRole("link", { name: "People" })).toBeTruthy();
  });

  it("marks the current page in the rail's More menu", async () => {
    renderSidebar("/memory", { collapsed: true });
    await userEvent.click(screen.getByRole("button", { name: "More" }));

    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Memory" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(menu).getByRole("menuitem", { name: "People" }).hasAttribute("aria-current"),
    ).toBe(false);
  });
});
