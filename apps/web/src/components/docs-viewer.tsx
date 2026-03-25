"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  ChevronRight,
  Search,
  X,
  Zap,
  Shield,
  BarChart3,
  Activity,
  Target,
  Layers,
  Clock,
  Database,
  Lock,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { apiFetch } from "@/lib/api";

interface DocItem {
  name: string;
  title: string;
  filename: string;
}

// Map doc names to icons for visual distinction
const DOC_ICONS: Record<string, React.ReactNode> = {
  architecture: <Layers className="size-4" />,
  "signal-engine": <Zap className="size-4" />,
  "score-engine": <Gauge className="size-4" />,
  "pressure-engine": <Activity className="size-4" />,
  "momentum-engine": <TrendingUp className="size-4" />,
  "pattern-engine": <Target className="size-4" />,
  "market-phase": <Clock className="size-4" />,
  "market-filter": <Shield className="size-4" />,
  "signal-accuracy": <BarChart3 className="size-4" />,
  "SUPPORT-RESISTANCE": <Layers className="size-4" />,
  "intraday-sr": <Layers className="size-4" />,
  "search-on-demand": <Search className="size-4" />,
  "DATA-FLOW": <Database className="size-4" />,
  DEPLOYMENT: <Database className="size-4" />,
  auth: <Lock className="size-4" />,
};

export function DocsViewer() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [docTitle, setDocTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Redirect non-admin
  useEffect(() => {
    if (!isLoading && (!user || user.role !== "ADMIN")) {
      router.push("/");
    }
  }, [isLoading, user, router]);

  const loadDoc = useCallback(async (name: string) => {
    setSelectedDoc(name);
    setContentLoading(true);
    try {
      const res = await apiFetch(`/api/docs/${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content ?? "");
        setDocTitle(data.title ?? name);
      }
    } catch {
      setContent("Failed to load document.");
    }
    setContentLoading(false);
  }, []);

  // Fetch docs list
  useEffect(() => {
    async function fetchDocs() {
      try {
        const res = await apiFetch("/api/docs");
        if (res.ok) {
          const data = await res.json();
          setDocs(data.docs ?? []);
          if (data.docs?.length > 0) {
            loadDoc(data.docs[0].name);
          }
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }
    if (user?.role === "ADMIN") fetchDocs();
  }, [user, loadDoc]);

  const filteredDocs = searchQuery
    ? docs.filter(
        (d) =>
          d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : docs;

  if (isLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading documentation...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Subtle gradient backdrop */}
      <div className="fixed inset-0 bg-gradient-to-br from-blue-500/[0.02] via-transparent to-purple-500/[0.02] pointer-events-none" />

      <div className="relative max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="sticky top-14 z-20 border-b border-border/40">
          <div className="bg-background/60 backdrop-blur-xl px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="size-3.5" />
                  Scanner
                </Link>
                <span className="text-border/50">/</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center size-6 rounded-md bg-blue-500/10">
                    <BookOpen className="size-3.5 text-blue-400" />
                  </div>
                  <h1 className="text-sm font-semibold tracking-tight">Documentation</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground/50 bg-muted/50 px-2 py-1 rounded-md border border-border/20">
                  {docs.length} docs
                </span>
                <span className="text-[10px] font-medium text-yellow-500/70 bg-yellow-500/5 px-2 py-1 rounded-md border border-yellow-500/10">
                  Admin
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <aside className="w-64 shrink-0 border-r border-border/30 min-h-[calc(100vh-7rem)] sticky top-[7rem] self-start overflow-y-auto">
            <div className="p-3 space-y-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
                <input
                  type="text"
                  placeholder="Filter..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-8 pl-8 pr-8 text-xs bg-muted/30 border border-border/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/30 placeholder:text-muted-foreground/30 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 hover:text-muted-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {/* Category label */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/30 px-2.5 pt-2">
                Engines & Systems
              </p>

              {/* Doc list */}
              <nav className="space-y-px">
                {filteredDocs.map((doc) => {
                  const isActive = selectedDoc === doc.name;
                  const icon = DOC_ICONS[doc.name] ?? <FileText className="size-4" />;
                  return (
                    <button
                      key={doc.name}
                      onClick={() => loadDoc(doc.name)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all duration-150 group ${
                        isActive
                          ? "bg-blue-500/10 text-blue-400"
                          : "text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground"
                      }`}
                    >
                      <span className={`shrink-0 ${isActive ? "text-blue-400" : "text-muted-foreground/40 group-hover:text-muted-foreground/60"}`}>
                        {icon}
                      </span>
                      <span className="text-[13px] truncate">{doc.title}</span>
                      {isActive && (
                        <ChevronRight className="size-3 ml-auto shrink-0 text-blue-400/60" />
                      )}
                    </button>
                  );
                })}
              </nav>

              {filteredDocs.length === 0 && (
                <div className="flex flex-col items-center py-8 text-muted-foreground/30">
                  <Search className="size-5 mb-2" />
                  <p className="text-xs">No results</p>
                </div>
              )}
            </div>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {contentLoading ? (
              <div className="flex items-center justify-center py-32">
                <div className="flex flex-col items-center gap-3">
                  <div className="size-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  <p className="text-xs text-muted-foreground/50">Loading...</p>
                </div>
              </div>
            ) : content ? (
              <article className="px-10 py-8 max-w-[52rem] mx-auto">
                {/* Doc title badge */}
                <div className="flex items-center gap-2 mb-6">
                  <span className="text-[10px] font-mono text-muted-foreground/40 bg-muted/30 px-2 py-0.5 rounded border border-border/20">
                    {selectedDoc}.md
                  </span>
                </div>

                {/* Markdown content */}
                <div className="prose prose-invert prose-sm max-w-none
                  prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
                  prose-h1:text-[1.75rem] prose-h1:mb-6 prose-h1:pb-4 prose-h1:border-b prose-h1:border-border/20
                  prose-h2:text-[1.35rem] prose-h2:mt-10 prose-h2:mb-4 prose-h2:text-foreground/90
                  prose-h3:text-base prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-foreground/80
                  prose-h4:text-sm prose-h4:mt-6 prose-h4:font-semibold prose-h4:text-foreground/70
                  prose-p:text-[13px] prose-p:text-muted-foreground/80 prose-p:leading-[1.8]
                  prose-strong:text-foreground/90 prose-strong:font-semibold
                  prose-a:text-blue-400 prose-a:no-underline prose-a:font-medium hover:prose-a:text-blue-300 hover:prose-a:underline
                  prose-code:text-emerald-400/90 prose-code:bg-emerald-500/[0.08] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[11px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-code:border prose-code:border-emerald-500/10
                  prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-border/20 prose-pre:rounded-xl prose-pre:text-[11px] prose-pre:leading-[1.7] prose-pre:shadow-lg prose-pre:shadow-black/20
                  prose-table:text-[12px] prose-table:border-collapse
                  prose-th:text-foreground/80 prose-th:font-semibold prose-th:bg-muted/20 prose-th:px-3 prose-th:py-2.5 prose-th:border prose-th:border-border/20 prose-th:text-left
                  prose-td:text-muted-foreground/70 prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-border/10
                  prose-tr:border-border/10
                  prose-blockquote:border-l-2 prose-blockquote:border-blue-500/40 prose-blockquote:bg-blue-500/[0.03] prose-blockquote:rounded-r-lg prose-blockquote:py-0.5 prose-blockquote:px-4 prose-blockquote:text-muted-foreground/70 prose-blockquote:text-[12px] prose-blockquote:not-italic
                  prose-li:text-[13px] prose-li:text-muted-foreground/80 prose-li:leading-[1.8] prose-li:marker:text-muted-foreground/30
                  prose-hr:border-border/20 prose-hr:my-8
                  prose-img:rounded-xl prose-img:border prose-img:border-border/20
                ">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                  </ReactMarkdown>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-6 border-t border-border/20">
                  <p className="text-[11px] text-muted-foreground/30">
                    TradeScanner Documentation — Auto-generated from source
                  </p>
                </div>
              </article>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 text-muted-foreground/30">
                <div className="size-16 rounded-2xl bg-muted/20 flex items-center justify-center mb-4 border border-border/10">
                  <BookOpen className="size-7" />
                </div>
                <p className="text-sm font-medium text-muted-foreground/50">Select a document</p>
                <p className="text-xs mt-1">Choose from the sidebar to start reading</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
