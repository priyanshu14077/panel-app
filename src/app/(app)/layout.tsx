import { Nav } from "../nav";

// The app pages share the rail: beside the page on wide screens, stacked above
// it below 900px. The landing page at / has no rail. Both share the Ember theme.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="ember ember-app min-h-dvh min-[900px]:grid min-[900px]:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <Nav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
