import { MapPinOff } from "lucide-react";
import { Empty } from "@/components/blocks";
export default function NotFound() { return <main className="site-container interior-page basic-center" id="main-content"><Empty title="We couldn’t find that page" text="It may have moved or the listing may no longer be available." href="/marketplace" action="Back to marketplace" icon={MapPinOff}/></main>; }
