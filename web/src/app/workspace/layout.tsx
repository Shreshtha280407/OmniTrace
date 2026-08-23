import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";

export const metadata = { title: "Workspace" };

/**
 * Shell for every /workspace route. The workspace is open — there is no
 * authentication layer in this build, so the only thing this establishes is
 * the shared workspace state and a fixed-height, non-scrolling frame for the
 * three-panel layout.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-ink-900">{children}</div>
    </WorkspaceProvider>
  );
}
