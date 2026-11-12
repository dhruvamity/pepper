import type { Metadata } from "next";
import { userPreview } from "@/lib/server/share";
import { UserView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return userPreview((await params).id);
}

export default function UserPage() {
  return <UserView />;
}
