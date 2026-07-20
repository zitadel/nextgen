import { createFileRoute } from "@tanstack/react-router";
import { FolderCheck, Play, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { Page } from "../components/layout";
import { Tag } from "../components/tag";

/**
 * The "General" screen — the one fully-designed frame in the Figma handoff. It is
 * a static mock rendered with the designed dummy data (no API), so designers and
 * reviewers can see the handed-off layout built pixel-for-pixel. Real, API-backed
 * screens live under their own routes (Users, Sessions, Projects, Login flows).
 */
export const Route = createFileRoute("/")({
  staticData: { nav: { label: "Get started", order: 0, icon: Play } },
  component: Dashboard,
});

const STAT_CARDS = [
  { title: "SL Mobbin", subtitle: "142 items" },
  { title: "SL Mobbin", subtitle: "142 items" },
] as const;

const TABS = ["Statistics", "Tab 2", "Tab 3", "Tab 4", "Tab 5"] as const;

const BROWSE_ROWS = [
  { title: "AS Mobbin", description: "Contains various files and project workflows for AS Mobbin." },
  { title: "Demo folder", description: "Contains various files and project workflows for Demo folder." },
  { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
  { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
  { title: "SL Mobbin", description: "Contains various files and project workflows for SL Mobbin." },
] as const;

function Dashboard() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const rows = BROWSE_ROWS.filter((row) => row.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Page>
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-zl-heading text-2xl tracking-[-0.48px] text-zl-text-primary">General</h1>
          <p className="text-sm text-zl-text-secondary">This is a sub headline</p>
        </div>
        <button
          type="button"
          className="flex h-10 shrink-0 items-center gap-2 rounded-zl-s bg-zl-action-primary-fill px-4 text-sm font-semibold text-zl-action-primary-label transition-colors hover:bg-zl-action-primary-fill-hover active:bg-zl-action-primary-fill-pressed"
        >
          Primary action
          <Plus size={16} aria-hidden />
        </button>
      </header>

      <div role="tablist" aria-label="Views" className="mt-6 flex flex-wrap gap-1 py-1">
        {TABS.map((tab, index) => {
          const active = index === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(index)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-zl-surface-subtle text-zl-text-primary"
                  : "border border-zl-border-subtle text-zl-text-secondary hover:bg-zl-surface-subtle hover:text-zl-text-primary"
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {STAT_CARDS.map((card, index) => (
          <div
            key={index}
            className="flex flex-col gap-4 rounded-zl-m bg-zl-surface-raised p-6"
          >
            <FolderCheck size={24} className="text-zl-text-primary" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold leading-6 text-zl-text-primary">{card.title}</p>
              <p className="text-xs leading-4 text-zl-text-secondary">{card.subtitle}</p>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-4 rounded-zl-m bg-zl-surface-raised p-6">
          <p className="text-2xl font-semibold tracking-[-0.5px] text-zl-text-primary">142</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm text-zl-text-secondary">Total Projects</p>
            <Tag>+ 18,0%</Tag>
          </div>
        </div>
      </div>

      <section className="mt-8 pt-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-zl-heading text-base text-zl-text-primary">Browse all</h2>
          <label className="flex w-full max-w-[360px] items-center gap-3 rounded-zl-s border border-zl-border-subtle bg-zl-surface-raised px-4 py-2.5">
            <Search size={16} className="shrink-0 text-zl-text-primary" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search"
              className="w-full bg-transparent text-sm text-zl-text-primary placeholder:text-zl-text-secondary focus:outline-none"
            />
          </label>
        </div>

        <div className="overflow-hidden rounded-zl-m border border-zl-border-subtle">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-zl-text-secondary">No results for “{query}”.</p>
          ) : (
            rows.map((row, index) => (
              <div
                key={index}
                className="flex cursor-pointer items-center gap-5 border-b border-zl-border-subtle p-5 transition-colors last:border-b-0 hover:bg-zl-surface-hover"
              >
                <FolderCheck size={24} className="shrink-0 text-zl-text-primary" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-semibold text-zl-text-primary">{row.title}</p>
                  <p className="truncate text-xs text-zl-text-secondary">{row.description}</p>
                </div>
                <span className="shrink-0 text-xs text-zl-text-secondary">Alex Smith</span>
                <button
                  type="button"
                  aria-label={`Remove ${row.title}`}
                  className="shrink-0 text-zl-text-tertiary hover:text-zl-text-primary"
                >
                  <Trash2 size={20} aria-hidden />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </Page>
  );
}
