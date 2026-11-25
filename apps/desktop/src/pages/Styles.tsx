import { Palette } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function Styles() {
  return <PlaceholderPage title="Styles" description="How your writing sounds in each kind of app." icon={<Palette size={18} />} />;
}
