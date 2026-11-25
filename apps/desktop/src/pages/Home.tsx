import { House } from "lucide-react";
import { PlaceholderPage } from "../components/PlaceholderPage";

/** Placeholder: replaced by its own task. */
export default function Home() {
  return <PlaceholderPage title="Home" description="Your dictation at a glance." icon={<House size={18} />} />;
}
