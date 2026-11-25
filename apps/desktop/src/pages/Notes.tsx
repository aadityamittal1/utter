import { StickyNote } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function Notes() {
  return <PlaceholderPage title="Notes" description="Quick notes you speak instead of type." icon={<StickyNote size={18} />} />;
}
