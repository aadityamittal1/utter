import type { ReactNode } from "react";
import { EmptyState, PageHeader } from "./ui";

/** Temporary body for pages that later tasks implement. */
export function PlaceholderPage({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={`${title} is on its way`} description="This page is built in a later step. Navigation, theme and data are already wired up." />
    </>
  );
}
