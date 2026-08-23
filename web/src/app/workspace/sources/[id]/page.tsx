import { SourceInspector } from "@/components/workspace/SourceInspector";

export const metadata = { title: "Source" };

export default function SourcePage({ params }: { params: { id: string } }) {
  return <SourceInspector sourceId={decodeURIComponent(params.id)} />;
}
