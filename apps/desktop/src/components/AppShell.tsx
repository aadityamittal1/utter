import { useEffect } from "react";
import { startStoreListeners, useNav, useSettings } from "../lib/store";
import { PAGE_COMPONENTS } from "../pages/registry";
import Onboarding from "../onboarding/Onboarding";
import { ToastHost } from "./ui/Toast";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const page = useNav((s) => s.page);
  const { settings, loading, error, load } = useSettings();

  useEffect(() => {
    void load();
    return startStoreListeners();
  }, [load]);

  if (loading) return <div className="h-full bg-bg" aria-busy="true" />;

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-8 text-center">
        <div>
          <h1 className="font-display text-3xl">Utter couldn't start</h1>
          <p className="mt-2 text-sm text-muted">{error ?? "Settings could not be loaded."}</p>
        </div>
      </div>
    );
  }

  if (!settings.onboarded) {
    return (
      <>
        <Onboarding />
        <ToastHost />
      </>
    );
  }

  const Page = PAGE_COMPONENTS[page];
  return (
    <div className="flex h-full bg-bg">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto" id="content">
        <div key={page} className="page-enter mx-auto w-full max-w-[920px] px-10 pb-16 pt-9">
          <Page />
        </div>
      </main>
      <ToastHost />
    </div>
  );
}
