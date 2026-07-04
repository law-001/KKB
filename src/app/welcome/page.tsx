import { requireUser } from "@/lib/auth";
import { WelcomeForm } from "@/components/welcome-form";
import { PageHeader } from "@/components/ui";

export default async function WelcomePage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const { next } = await props.searchParams;

  return (
    <div className="mx-auto max-w-sm space-y-8">
      <div className="rise">
        <PageHeader eyebrow="Almost there" title="What should we call you?" />
      </div>
      <div className="rise rise-1">
        <WelcomeForm next={next ?? "/groups"} defaultName={user.name} />
      </div>
    </div>
  );
}
