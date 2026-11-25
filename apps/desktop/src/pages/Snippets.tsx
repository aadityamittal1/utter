import { TextCursorInput } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function Snippets() {
  return <PlaceholderPage title="Snippets" description="Say a short phrase, get the full text." icon={<TextCursorInput size={18} />} />;
}
