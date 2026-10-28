import type { ReactNode } from "react";
import { ArrowUpRight, CheckCircle2, Globe2, LockKeyhole, Monitor } from "lucide-react";
import { Brand, LogoMark } from "./Brand";
import { isFileSystemAccessSupported } from "../lib/fs";

const CHROME_URL = "https://www.google.com/chrome/";
const EDGE_URL = "https://www.microsoft.com/edge";

export function BrowserGate({ children }: { children: ReactNode }) {
  if (isFileSystemAccessSupported()) return <>{children}</>;

  const secure = typeof window !== "undefined" && window.isSecureContext;

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 text-slate-200">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(52,211,153,.12),transparent_32%),radial-gradient(circle_at_85%_25%,rgba(56,189,248,.1),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.25] [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <Brand />
        <main className="flex flex-1 items-center py-12">
          <div className="grid w-full gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
                <Monitor className="h-3.5 w-3.5" />
                Desktop browser required
              </span>
              <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                This tool needs direct, local folder access.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
                Adley ML Tools labels images on your computer without uploading them. That
                requires the File System Access API, available in current versions of Chrome and
                Microsoft Edge on desktop.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={CHROME_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-ink-950 transition hover:bg-mint-300"
                >
                  Get Chrome
                  <ArrowUpRight className="h-4 w-4" />
                </a>
                <a
                  href={EDGE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                >
                  Get Edge
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-5 text-xs text-slate-500">
                Firefox, Safari, and mobile browsers do not currently support this API.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 shadow-panel backdrop-blur">
              <div className="flex items-center gap-3">
                <LogoMark className="h-10 w-10" />
                <div>
                  <p className="text-sm font-semibold text-white">Compatibility check</p>
                  <p className="text-xs text-slate-500">Local processing stays on this device</p>
                </div>
              </div>
              <div className="mt-6 space-y-3 text-sm">
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3.5">
                  <Monitor className="mt-0.5 h-4 w-4 text-sky-300" />
                  <div>
                    <p className="font-medium text-slate-200">Chrome or Edge desktop</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      Required for folder pickers, workers, and file copies.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3.5">
                  <LockKeyhole className="mt-0.5 h-4 w-4 text-mint-300" />
                  <div>
                    <p className="font-medium text-slate-200">Secure HTTPS connection</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      {secure
                        ? "This page is running in a secure context."
                        : "Open the site over HTTPS. Localhost is allowed during development."}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                  <div>
                    <p className="font-medium text-slate-200">No dataset upload</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      Images and checkpoints stay inside the folders you choose.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
                <Globe2 className="h-3.5 w-3.5" />
                Need help? Use a Chromium-based desktop browser.
              </div>
            </div>
          </div>
        </main>
        <p className="text-xs text-slate-600">
          Adley Machine Learning Tools · Local-first labeling
        </p>
      </div>
    </div>
  );
}
