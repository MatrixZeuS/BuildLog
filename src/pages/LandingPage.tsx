import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  History,
  Lock,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getButtonClasses } from '../components/ui/Button';

type ShowcaseScenarioId = 'push' | 'pr' | 'issue' | 'memory';

interface ShowcaseScenario {
  id: ShowcaseScenarioId;
  label: string;
  eventTitle: string;
  branchOrRef: string;
  ingestionLines: Array<{ tag: string; detail: string; accent?: 'lime' | 'amber' | 'neutral' }>;
  handoffHeading: string;
  handoffContent: string;
}

const SHOWCASE_SCENARIOS: ShowcaseScenario[] = [
  {
    id: 'push',
    label: 'New changes',
    eventTitle: 'Maya saved new work to GitHub',
    branchOrRef: '2 changes · just now',
    ingestionLines: [
      { tag: 'WHAT', detail: 'Added a "Forgot password" link to the sign-in page', accent: 'lime' },
      { tag: 'WHAT', detail: 'Fixed the checkout button not working on phones', accent: 'lime' },
      { tag: 'WHERE', detail: 'Sign-in page, checkout page', accent: 'neutral' },
      { tag: 'GROUPED', detail: 'Part of a 30-minute burst of work on sign-in (our best guess)', accent: 'amber' },
    ],
    handoffHeading: 'Project summary · Online shop',
    handoffContent: `# Where things stand: Online shop

## Goal
Let customers buy from our shop on any device.

## What changed recently
- Added a "Forgot password" link to the sign-in page
- Fixed the checkout button not working on phones

## Parts of the project that changed
- Sign-in
- Checkout`,
  },
  {
    id: 'pr',
    label: 'Work waiting for review',
    eventTitle: 'Maya asked for a review (pull request #42)',
    branchOrRef: 'Waiting for review',
    ingestionLines: [
      { tag: 'REVIEW', detail: '"Add password reset emails" is ready for someone to check', accent: 'lime' },
      { tag: 'STATUS', detail: 'Not merged yet, so it isn\'t live', accent: 'neutral' },
      { tag: 'NEXT', detail: 'Suggested: review #42 before the next release', accent: 'amber' },
    ],
    handoffHeading: 'Waiting for review · Online shop',
    handoffContent: `## Waiting for review
- #42: Add password reset emails

## Suggested next steps
1. Review #42 so it can go live
2. Test the reset email on a phone`,
  },
  {
    id: 'issue',
    label: 'Problems reported',
    eventTitle: 'A problem was reported (issue #19)',
    branchOrRef: 'Still open',
    ingestionLines: [
      { tag: 'PROBLEM', detail: '#19: "Orders sometimes go missing after a restart"', accent: 'amber' },
      { tag: 'BLOCKER', detail: 'Listed as a blocker because #19 is still open on GitHub', accent: 'lime' },
      { tag: 'LINK', detail: 'Links straight to the issue on GitHub', accent: 'neutral' },
    ],
    handoffHeading: 'Open problems · Online shop',
    handoffContent: `## Open problems
- #19: Orders sometimes go missing after a restart

## Blockers
- #19 is still open

> BuildLog only lists a blocker when GitHub shows a real open problem.`,
  },
  {
    id: 'memory',
    label: 'Project summary',
    eventTitle: 'Your project summary, always up to date',
    branchOrRef: 'Updates automatically',
    ingestionLines: [
      { tag: 'COMBINES', detail: 'Recent changes, reviews and problems in one place', accent: 'lime' },
      { tag: 'HONEST', detail: 'Facts from GitHub are kept apart from AI suggestions', accent: 'lime' },
      { tag: 'PRIVATE', detail: 'Only titles and file names are saved, never your code', accent: 'neutral' },
      { tag: 'SHARE', detail: 'Copy it into a doc, a chat or an AI assistant', accent: 'lime' },
    ],
    handoffHeading: 'online-shop-summary.md',
    handoffContent: `# Where things stand: Online shop

## Facts from GitHub
- 2 changes saved today
- 1 piece of work waiting for review (#42)
- 1 open problem (#19)

## Suggested next steps
1. Review #42: Add password reset emails
2. Look into #19: orders going missing`,
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const [activeScenarioId, setActiveScenarioId] = useState<ShowcaseScenarioId>('push');
  const [copiedDemo, setCopiedDemo] = useState(false);

  const activeScenario =
    SHOWCASE_SCENARIOS.find((s) => s.id === activeScenarioId) ?? SHOWCASE_SCENARIOS[0];

  const handleCopyDemo = async () => {
    try {
      await navigator.clipboard.writeText(activeScenario.handoffContent);
      setCopiedDemo(true);
      window.setTimeout(() => setCopiedDemo(false), 2000);
    } catch {
      // Ignore clipboard failure in headless browsers
    }
  };

  return (
    <div className="min-h-screen bg-[#080908] text-[#F3F5EF] flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-[#252D24] bg-[#080908]/90 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 text-lg font-display font-bold tracking-tight text-[#FCFFEC] whitespace-nowrap shrink-0"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#B8F34A] text-[#090B09]">
              <TerminalSquare className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>BuildLog</span>
          </Link>

          <nav
            aria-label="Landing navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#929B90]"
          >
            <a href="#preview" className="hover:text-[#FCFFEC] transition-colors whitespace-nowrap shrink-0">
              How it works
            </a>
            <a href="#architecture" className="hover:text-[#FCFFEC] transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#memory-bento" className="hover:text-[#FCFFEC] transition-colors whitespace-nowrap shrink-0">
              Summaries
            </a>
            <a href="#privacy" className="hover:text-[#FCFFEC] transition-colors whitespace-nowrap shrink-0">
              Privacy
            </a>
            {!user && (
              <Link to="/login" className="hover:text-[#FCFFEC] transition-colors whitespace-nowrap shrink-0">
                Sign In
              </Link>
            )}
          </nav>

          <div className="shrink-0">
            <Link
              to={user ? '/dashboard' : '/signup'}
              className={getButtonClasses('primary', 'sm')}
            >
              <span>{user ? 'Open BuildLog' : 'Get started'}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-[#252D24]">
          <div
            className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[420px] w-[760px] rounded-full bg-[#B8F34A]/[0.08] blur-[140px]"
            aria-hidden="true"
          />
          <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-30" aria-hidden="true" />

          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-14 text-center">
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#B8F34A]">
              A diary for your projects that writes itself
            </p>

            <h1
              className="mt-5 font-display font-bold tracking-tight text-[#FCFFEC] leading-[1.06]"
              style={{ fontSize: 'clamp(2.35rem, 4.5vw, 3.85rem)', textWrap: 'balance' }}
            >
              Always know where
              <br />
              your project stands.
              <br />
              <span className="text-[#B8F34A]">No notes needed.</span>
            </h1>

            <p className="mt-6 text-base sm:text-lg text-[#929B90] leading-relaxed max-w-2xl mx-auto">
              Connect your project on GitHub once. BuildLog quietly keeps track of every change, review and reported problem, and turns it into a short, plain-English summary you can read or share anytime.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <Link
                to={user ? '/dashboard' : '/signup'}
                className={getButtonClasses('primary', 'lg')}
              >
                <GitBranch className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{user ? 'Open BuildLog' : 'Get started free'}</span>
              </Link>
              <a href="#preview" className={getButtonClasses('secondary', 'lg')}>
                <Zap className="w-4 h-4 shrink-0 text-[#B8F34A]" aria-hidden="true" />
                <span>See an example</span>
              </a>
            </div>

            <p className="mt-5 text-xs text-[#929B90]">
              Read-only access · Your code is never stored · Free to start
            </p>
          </div>

          {/* Dual-Pane Interactive Ingestion & Resume Brief Showcase */}
          <div id="preview" className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] shadow-[0_24px_80px_rgba(0,0,0,0.65)] overflow-hidden">
              {/* Showcase Window Chrome */}
              <div className="px-4 sm:px-5 py-3 border-b border-[#252D24] bg-[#0D0F0D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-[#929B90] truncate">
                    Example · an online shop project
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {SHOWCASE_SCENARIOS.map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => setActiveScenarioId(scenario.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        activeScenarioId === scenario.id
                          ? 'bg-[#B8F34A] text-[#090B09] font-semibold'
                          : 'bg-[#181B18] text-[#929B90] hover:text-[#FCFFEC]'
                      }`}
                    >
                      {scenario.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dual-Pane Content */}
              <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#252D24]">
                {/* Left Pane: Automated Webhook Ingestion */}
                <div className="lg:col-span-6 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#B8F34A] truncate">
                      {activeScenario.eventTitle}
                    </span>
                    <span className="text-xs text-[#929B90] shrink-0">
                      {activeScenario.branchOrRef}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {activeScenario.ingestionLines.map((line, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-[#252D24] bg-[#080908] px-3.5 py-2.5 flex items-start gap-3 text-xs"
                      >
                        <span
                          className={`font-mono font-semibold shrink-0 w-16 ${
                            line.accent === 'lime'
                              ? 'text-[#B8F34A]'
                              : line.accent === 'amber'
                              ? 'text-amber-300'
                              : 'text-[#929B90]'
                          }`}
                        >
                          {line.tag}
                        </span>
                        <span className="text-[#F3F5EF]/90 leading-relaxed text-xs">
                          {line.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Pane: Structured Resume Context */}
                <div className="lg:col-span-6 p-5 sm:p-6 flex flex-col justify-between bg-[#0B0D0B]">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="text-xs font-medium text-[#FCFFEC] truncate">
                        {activeScenario.handoffHeading}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyDemo()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#252D24] bg-[#181B18] px-2.5 py-1 text-xs font-medium text-[#929B90] hover:text-[#FCFFEC] hover:border-[#394637] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                      >
                        {copiedDemo ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#B8F34A]" aria-hidden="true" />
                            <span className="text-[#B8F34A]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Copy summary</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="rounded-xl border border-[#252D24] bg-[#080908] p-4 text-xs font-mono text-[#F3F5EF]/90 leading-relaxed whitespace-pre-wrap break-words">
                      {activeScenario.handoffContent}
                    </pre>
                  </div>

                  <p className="mt-4 text-[11px] text-[#929B90]">
                    Everything in the summary comes from real activity on GitHub. Guesses are clearly labelled.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Editorial Problem Statement */}
        <section className="border-b border-[#252D24] bg-[#0A0C0A]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center space-y-5">
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#B8F34A]">
              The problem
            </p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#FCFFEC] leading-snug">
              &ldquo;Nobody should spend Monday morning digging through last week's work just to remember where a project left off.&rdquo;
            </h2>
            <p className="text-sm sm:text-base text-[#929B90] leading-relaxed max-w-2xl mx-auto">
              Notes and status updates go stale as soon as things get busy. BuildLog keeps an up-to-date summary for you in the background, ready whenever you or your team need it.
            </p>
          </div>
        </section>

        {/* Architecture Pillars (Clean Editorial Numbering) */}
        <section id="architecture" className="border-b border-[#252D24]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#B8F34A]">
                How it works
              </p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#FCFFEC]">
                Three steps, then it runs by itself
              </h2>
              <p className="mt-2 text-sm sm:text-base text-[#929B90]">
                Work the way you already do. BuildLog follows along in the background.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  num: '01. Connect',
                  title: 'Link your GitHub project',
                  desc: 'Paste your project link and approve read-only access on GitHub. BuildLog copies your recent work straight away.',
                  bullets: ['Takes about a minute', 'BuildLog can read, never change'],
                },
                {
                  num: '02. Keep working',
                  title: 'Changes are recorded for you',
                  desc: 'Every time someone saves work, asks for a review or reports a problem on GitHub, BuildLog notes it down. Facts and AI guesses are always kept apart.',
                  bullets: ['Updates arrive automatically', 'Optional AI summaries'],
                },
                {
                  num: '03. Catch up instantly',
                  title: 'Read or share the summary',
                  desc: 'Open any project to see what changed, what is waiting and what to do next, in plain English. Copy it or download it in one click.',
                  bullets: ['One-click copy or download', 'Export or delete your data anytime'],
                },
              ].map((pillar) => (
                <article
                  key={pillar.num}
                  className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-5"
                >
                  <div>
                    <p className="text-xs font-mono text-[#B8F34A]">{pillar.num}</p>
                    <h3 className="mt-2 text-lg font-display font-semibold text-[#FCFFEC]">
                      {pillar.title}
                    </h3>
                    <p className="mt-2.5 text-sm text-[#929B90] leading-relaxed">{pillar.desc}</p>
                  </div>
                  <ul className="pt-4 border-t border-[#252D24] space-y-1.5 text-xs font-mono text-[#F3F5EF]/80">
                    {pillar.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#B8F34A] shrink-0" aria-hidden="true" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Bento Feature Showcase Grid */}
        <section id="memory-bento" className="border-b border-[#252D24]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <div className="max-w-2xl mb-10">
              <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#B8F34A]">
                What you get
              </p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#FCFFEC]">
                A clear picture of every project, built from real work
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Wide Bento Card: Project Memory & Modified Areas */}
              <div className="md:col-span-2 rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#181B18] border border-[#252D24] text-[#B8F34A]">
                    <FileCode2 className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-mono text-[#929B90]">
                    Example Output
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-display font-semibold text-[#FCFFEC]">
                    A living project summary
                  </h3>
                  <p className="mt-2 text-sm text-[#929B90] leading-relaxed max-w-2xl">
                    See which parts of the project are changing, what's waiting for review and which problems are still open, together with your goal for the project, in one easy-to-share page.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 text-xs space-y-1">
                    <p className="text-[#929B90]">Parts that changed</p>
                    <p className="text-[#B8F34A]">Checkout (4 files)</p>
                    <p className="text-[#F3F5EF]">Sign-in (3 files)</p>
                  </div>
                  <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 text-xs space-y-1">
                    <p className="text-[#929B90]">Still open</p>
                    <p className="text-emerald-300">#42 · Password reset emails (review)</p>
                    <p className="text-amber-300">#19 · Missing orders (problem)</p>
                  </div>
                </div>
              </div>

              {/* Card 2: Inferred Clusters */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#181B18] border border-[#252D24] text-[#B8F34A]">
                  <History className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-semibold text-[#FCFFEC]">
                    Work grouped into sessions
                  </h3>
                  <p className="mt-2 text-sm text-[#929B90] leading-relaxed">
                    Changes made close together are grouped into work sessions, so the timeline is easy to scan. Groupings are labelled as estimates, not hours worked.
                  </p>
                </div>
                <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between text-[#929B90]">
                    <span>Work session</span>
                    <span>about 30 min</span>
                  </div>
                  <p className="text-[#FCFFEC]">3 changes · Sign-in</p>
                </div>
              </div>

              {/* Card 3: Optional AI Summarization */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#181B18] border border-[#252D24] text-[#B8F34A]">
                  <Sparkles className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-semibold text-[#FCFFEC]">
                    Optional AI summaries
                  </h3>
                  <p className="mt-2 text-sm text-[#929B90] leading-relaxed">
                    AI can write a short recap and suggest next steps, always marked apart from the facts. If AI is switched off, everything is still recorded.
                  </p>
                </div>
              </div>

              {/* Card 4: Multi-Event Stream */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#181B18] border border-[#252D24] text-[#B8F34A]">
                  <GitPullRequest className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-semibold text-[#FCFFEC]">
                    Changes, reviews &amp; problems
                  </h3>
                  <p className="mt-2 text-sm text-[#929B90] leading-relaxed">
                    Copies your recent history when you connect, then keeps up with new changes, review requests and reported problems as they happen.
                  </p>
                </div>
              </div>

              {/* Card 5: Zero Lock-In Export */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col justify-between gap-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#181B18] border border-[#252D24] text-[#B8F34A]">
                  <Download className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-semibold text-[#FCFFEC]">
                    Your data, your call
                  </h3>
                  <p className="mt-2 text-sm text-[#929B90] leading-relaxed">
                    Download everything BuildLog has saved for you, or delete it all, in one click.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Honest Privacy & Security Guarantees */}
        <section id="privacy" className="border-b border-[#252D24] bg-[#0A0C0A]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 sm:p-10">
              <div className="max-w-2xl">
                <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#B8F34A]">
                  Privacy
                </p>
                <h2 className="mt-2 text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#FCFFEC]">
                  We track the activity. You keep your source code.
                </h2>
                <p className="mt-3 text-sm sm:text-base text-[#929B90] leading-relaxed">
                  BuildLog can only read your project, never change it. It saves short descriptions of the work (titles, dates and file names), not your actual code.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    icon: ShieldCheck,
                    title: 'Read-only access',
                    desc: 'BuildLog can never change your project. Disconnect or pause anytime.',
                  },
                  {
                    icon: Lock,
                    title: 'Only you can see your data',
                    desc: 'Each account is kept separate. Other users can never see your projects.',
                  },
                  {
                    icon: GitCommit,
                    title: 'No code stored',
                    desc: 'Only descriptions of the work are saved. You control this in Settings.',
                  },
                  {
                    icon: ArrowRight,
                    title: 'Verified updates',
                    desc: 'Every update is checked to make sure it really came from GitHub.',
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-2"
                    >
                      <Icon className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
                      <h3 className="text-sm font-display font-semibold text-[#FCFFEC]">
                        {item.title}
                      </h3>
                      <p className="text-xs text-[#929B90] leading-relaxed">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="relative overflow-hidden py-20">
          <div
            className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-56 w-[560px] rounded-full bg-[#B8F34A]/[0.07] blur-[120px]"
            aria-hidden="true"
          />
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-4xl font-display font-bold tracking-tight text-[#FCFFEC]">
              Never lose track of a project again.
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#929B90] max-w-xl mx-auto">
              Create a free account, connect a project, and let BuildLog keep the summary up to date for you.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={user ? '/dashboard' : '/signup'}
                className={getButtonClasses('primary', 'lg')}
              >
                <GitBranch className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{user ? 'Open BuildLog' : 'Create a free account'}</span>
              </Link>
              {!user && (
                <Link to="/login" className={getButtonClasses('secondary', 'lg')}>
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#252D24] bg-[#080908] py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8 text-xs text-[#929B90]">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 text-sm font-display font-bold text-[#FCFFEC]">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[#B8F34A] text-[#090B09]">
                <TerminalSquare className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span>BuildLog</span>
            </div>
            <p className="leading-relaxed">
              Always know where your project stands. Built for solo makers, students and teams.
            </p>
          </div>

          <div className="space-y-2">
            <p className="uppercase tracking-wider text-[11px] text-[#FCFFEC]">Product</p>
            <ul className="space-y-1.5">
              <li><a href="#preview" className="hover:text-[#FCFFEC] transition-colors">See an example</a></li>
              <li><a href="#architecture" className="hover:text-[#FCFFEC] transition-colors">How it works</a></li>
              <li><a href="#memory-bento" className="hover:text-[#FCFFEC] transition-colors">Project summaries</a></li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="uppercase tracking-wider text-[11px] text-[#FCFFEC]">Privacy</p>
            <ul className="space-y-1.5">
              <li><a href="#privacy" className="hover:text-[#FCFFEC] transition-colors">Read-only access</a></li>
              <li><a href="#privacy" className="hover:text-[#FCFFEC] transition-colors">No code stored</a></li>
              <li><a href="#privacy" className="hover:text-[#FCFFEC] transition-colors">Download your data</a></li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="uppercase tracking-wider text-[11px] text-[#FCFFEC]">Account</p>
            <ul className="space-y-1.5">
              <li><Link to="/login" className="hover:text-[#FCFFEC] transition-colors">Sign in</Link></li>
              <li><Link to="/signup" className="hover:text-[#FCFFEC] transition-colors">Create account</Link></li>
              <li><Link to="/reset-password" className="hover:text-[#FCFFEC] transition-colors">Reset Password</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
