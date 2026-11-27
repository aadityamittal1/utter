import { useEffect } from "react";
import { useNav, useStoreListeners, useSettings } from "../lib/store";
import { PAGE_COMPONENTS } from "../pages/registry";
import Onboarding from "../onboarding/Onboarding";
import { ToastHost } from "./ui/Toast";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { ErrorBoundary } from "./ErrorBoundary";
import SettingsDialog from "../pages/settings/SettingsDialog";

export function AppShell() {
  const page = useNav((s) => s.page);
  const { settings, loading, error, load } = useSettings();

  useStoreListeners();
  useEffect(() => {
    void load();
  }, [load]);

  // A settings request that arrived before onboarding finished must not pop open afterwards.
  const onboarded = settings?.onboarded;
  useEffect(() => {
    if (onboarded === false) useNav.getState().closeSettings();
  }, [onboarded]);

  if (loading)
    return (
      <div className="flex h-full flex-col bg-bg" aria-busy="true">
        <TitleBar showSidebarToggle={false} />
      </div>
    );

  if (!settings) {
    return (
      <div className="flex h-full flex-col bg-bg">
        <TitleBar showSidebarToggle={false} />
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <h1 className="text-title text-ink">Utter couldn't start</h1>
            <p className="mt-2 text-body text-muted">{error ?? "Settings could not be loaded."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!settings.onboarded) {
    return (
      <div className="flex h-full flex-col bg-bg">
        <TitleBar showSidebarToggle={false} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Onboarding />
        </div>
        <ToastHost />
      </div>
    );
  }

  const Page = PAGE_COMPONENTS[page === "settings" ? "home" : page];
  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* Content panel: warm layer under the title bar, inset 8px right and bottom. */}
        <main id="content" className="mb-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-shell border border-line bg-panel">
          <div key={page} className="page-enter mx-auto w-full max-w-[880px] px-10 pb-16 pt-10">
            <ErrorBoundary resetKey={page}>
              <Page />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <SettingsDialog />
      <ToastHost />
    </div>
  );
}
