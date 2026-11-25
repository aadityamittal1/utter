import { History as HistoryIcon } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function History() {
  return <PlaceholderPage title="History" description="Everything you have dictated, searchable." icon={<HistoryIcon size={18} />} />;
}
