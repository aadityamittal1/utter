import { BookA } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function Dictionary() {
  return <PlaceholderPage title="Dictionary" description="Words Utter should always spell your way." icon={<BookA size={18} />} />;
}
